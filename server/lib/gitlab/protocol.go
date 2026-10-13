package gitlab

import (
	"encoding/json"
	"reflect"

	"typst-editor/server/lib/ydoc"
)

// What the widget and the server agree on about a GitLab room: the maps of its document and the stateless
// messages (the Go side of src/core/room-protocol/room-protocol.ts; field names are the wire's).
const (
	filesMap  = "files"  // path → Y.Text: the .typ files
	assetsMap = "assets" // path → blob sha (as in the repository) or []byte (uploaded, not committed yet)
	metaMap   = "meta"   // the repository state, written by the server only (see base and the meta* keys)
)

// The keys of the meta map besides base's.
const (
	metaChanges    = "changes"       // *roomChanges: what the room has that the branch has not
	metaConflict   = "conflict"      // *roomConflict: upstream changes that conflict with the room's
	metaFailure    = "commitFailure" // *commitFailure: the last commit failed
	metaAutoCommit = "autoCommit"    // minutes without edits before the server commits by itself; null: never
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

// clientMessage is the stateless message a client sends to save.
type clientMessage struct {
	Type    string `json:"type"` // gitlab:save
	Message string `json:"message"`
	Author  *struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"author"`
}

// message is a stateless message to clients: the outcome of a save, a commit by the server or a merge.
type message struct {
	Type      string         `json:"type"` // one of the msg* constants
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
