package gitlab

import (
	"encoding/json"
	"reflect"

	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// What the widget and the server agree on about a GitLab room: the maps of its document and the stateless
// messages (the Go side of src/extensions/collaboration/room-protocol.ts; field names are the wire's).
const (
	filesMap  = "files"  // path → Y.Text: the .typ files
	assetsMap = "assets" // path → blob sha (as in the repository) or []byte (uploaded, not committed yet)
	metaMap   = "meta"   // the repository state, written by the server only (see base and the meta* keys)
)

// The keys of the meta map besides base's.
const (
	metaChanges    = "changes"       // *roomChanges: what the room has that the branch has not
	metaConflict   = "conflict"      // *roomConflict: upstream changes that conflict with the room's
	metaFailure    = "commitFailure" // *commitFailure: the last commit failed, or what it left out
	metaAutoCommit = "autoCommit"    // minutes without edits before the server commits by itself; null: never
	metaPulledIn   = "pulledIn"      // []string: the files from outside the room's folder it holds (pullIn), sorted
)

// base is the commit the room is based on, as kept in the meta map (one key per field).
type base struct {
	Sha    string            `json:"baseSha"`
	Texts  map[string]string `json:"base"`       // the .typ files at Sha
	Assets map[string]string `json:"baseAssets"` // the other files at Sha, by blob sha
}

type roomChanges struct {
	Files   []changedFile `json:"files"`
	Since   int64         `json:"since"` // milliseconds since the epoch, the server's clock
	Editors []string      `json:"editors"`
	// EditorIDs are the editors' user ids on this GitLab (as Editors; "": not known), for the server
	EditorIDs []string `json:"editorIds"`
}

type changedFile struct {
	Path string `json:"path"`
	Kind string `json:"kind"` // added, modified, deleted
}

type roomConflict struct {
	Sha   string   `json:"sha"`
	Paths []string `json:"paths"`
}

type commitFailure struct {
	Message string `json:"message"`
	At      int64  `json:"at"`
}

// clientMessage is a stateless message of a client: a save, or the request for a file from outside the
// room's folder.
type clientMessage struct {
	Type    string `json:"type"`    // gitlab:save, gitlab:pull
	Message string `json:"message"` // gitlab:save: the commit message
	Path    string `json:"path"`    // gitlab:pull: the file ("/template.typ")
}

// message is a stateless message to clients: the outcome of a save, a commit by the server, a merge, or
// a file the room cannot pull in.
type message struct {
	Type      string         `json:"type"` // one of the msg* constants
	Path      string         `json:"path,omitempty"`
	Sha       string         `json:"sha,omitempty"`
	Author    string         `json:"author,omitempty"`
	Automatic bool           `json:"automatic,omitempty"`
	Files     []fileConflict `json:"files,omitempty"`
	Message   string         `json:"message,omitempty"`
}

const (
	msgSaved     = "gitlab:saved"     // committed (to everyone)
	msgUnchanged = "gitlab:unchanged" // nothing to commit (to the saving client)
	msgMerged    = "gitlab:merged"    // upstream merged into the room (to everyone)
	msgConflict  = "gitlab:conflict"  // upstream could not be merged (to everyone)
	msgError     = "gitlab:error"     // the save failed (to the saving client)
	msgMissing   = "gitlab:missing"   // a file asked for (gitlab:pull) is not pulled in, and why (to the asking client)
)

type fileConflict struct {
	Path   string          `json:"path"`
	Ranges []conflictRange `json:"ranges"` // empty: the file as a whole (changed on one side, deleted on the other)
}

// conflictRange is a range of the room's text that could not be merged (UTF-16 offsets).
type conflictRange struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// historyPage is an answer of the history endpoint (ServeHistory): commits newest first, and where the list
// goes on (?cursor=; "": no more).
type historyPage struct {
	Commits []historyCommit `json:"commits"`
	Cursor  string          `json:"cursor,omitempty"`
}

type historyCommit struct {
	Sha     string   `json:"sha"`
	Parents []string `json:"parents"`
	Message string   `json:"message"` // trailers included
	At      int64    `json:"at"`      // when it was committed: milliseconds since the epoch
	// People are who made it, by name: the author, then the Co-authored-by trailers; never the committer
	// Zwiebelfisch
	People []string `json:"people"`
}

// compareAnswer is the answer of the compare endpoint (ServeCompare): the files a commit changed.
type compareAnswer struct {
	Files []historyFile `json:"files"`
}

type historyFile struct {
	Path         string `json:"path"`
	PreviousPath string `json:"previousPath,omitempty"` // renamed: where it was
	Kind         string `json:"kind"`                   // added, modified, deleted, renamed
}

func (m message) json() string {
	b, _ := json.Marshal(m) // plain fields only
	return string(b)
}

// readMeta returns the room's base, or nil if it has none yet (a new room).
func readMeta(doc *ydoc.Doc) *base {
	values := doc.Values(metaMap)
	if _, ok := values["baseSha"].(string); !ok {
		return nil
	}
	var b base
	if !decode(values, &b) {
		return nil
	}
	return &b
}

// readPulledIn is the room's meta.pulledIn.
func readPulledIn(doc *ydoc.Doc) []string {
	var paths []string
	readValue(doc, metaPulledIn, &paths)
	return paths
}

// readValue decodes the meta value under key into v; false if it is missing or null.
func readValue(doc *ydoc.Doc, key string, v any) bool {
	value := doc.Values(metaMap)[key]
	return value != nil && decode(value, v)
}

// writeBase writes a new base (loaded, merged or committed): any conflict is resolved, any failed commit
// is over.
func writeBase(w *ydoc.Writer, doc *ydoc.Doc, b base) {
	w.Set(metaMap, "baseSha", b.Sha)
	w.Set(metaMap, "base", plain(b.Texts))
	w.Set(metaMap, "baseAssets", plain(b.Assets))
	values := doc.Values(metaMap)
	for _, key := range []string{metaConflict, metaFailure} {
		if values[key] != nil {
			w.Set(metaMap, key, nil)
		}
	}
}

// plain turns v into the JSON-like values a document holds (map[string]any, []any, float64, …).
func plain(v any) any {
	if v == nil || (reflect.ValueOf(v).Kind() == reflect.Pointer && reflect.ValueOf(v).IsNil()) {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // our own types only
	}
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

// decode reads a document value (as plain gives) into v.
func decode(value, v any) bool {
	b, err := json.Marshal(value)
	return err == nil && json.Unmarshal(b, v) == nil
}
