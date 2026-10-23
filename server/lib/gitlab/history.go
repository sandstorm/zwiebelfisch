package gitlab

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/go-git/go-git/v6/plumbing"

	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// historyLimit is the most commits one answer of ServeHistory lists.
const historyLimit = 50

// ServeHistory answers the commits of an open room's branch that changed ?path= (historyPage, newest
// first, at most historyLimit or ?limit=): from the room's base commit on, or from ?cursor= (an earlier
// answer's) on. The path: "" the room's folder (the whole repository without one), "/dir/" a folder, "/a.typ"
// a file; in a room of one folder, a folder in it or a file it holds or pulled in, else 403. Access as
// ServeFile; an answer from a cursor is cached for good.
func (x *Rooms) ServeHistory(w http.ResponseWriter, r *http.Request) {
	open := x.openFor(w, r)
	if open == nil {
		return
	}
	q := r.URL.Query()
	sha, pulled := open.readScope()
	p, ok := open.historyPath(q.Get("path"), pulled)
	if !ok {
		http.Error(w, "Outside the room's folder", http.StatusForbidden)
		return
	}
	limit, err := strconv.Atoi(q.Get("limit"))
	if err != nil || limit <= 0 || limit > historyLimit {
		limit = historyLimit
	}
	commits, next, err := open.repo.Log(LogQuery{Sha: sha, Path: p, Cursor: q.Get("cursor"), Limit: limit})
	if !answered(w, err) {
		return
	}
	page := historyPage{Commits: []historyCommit{}, Cursor: next}
	for _, c := range commits {
		page.Commits = append(page.Commits, historyCommit{
			Sha: c.Sha, Parents: append([]string{}, c.Parents...), Message: c.Message, At: c.At.UnixMilli(), People: people(c),
		})
	}
	cache(w, q.Get("cursor") != "")
	reply(w, page)
}

// ServeCompare answers the files commit ?sha= changed against its first parent (compareAnswer); in a room of
// one folder only those it holds or pulled in (a rename from or to elsewhere as added or deleted). Access as
// ServeFile; cached for good in a room of the whole repository.
func (x *Rooms) ServeCompare(w http.ResponseWriter, r *http.Request) {
	open := x.openFor(w, r)
	if open == nil {
		return
	}
	sha := r.URL.Query().Get("sha")
	if !plumbing.IsHash(sha) {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	changes, err := open.repo.Compare(sha)
	if !answered(w, err) {
		return
	}
	_, pulled := open.readScope()
	answer := compareAnswer{Files: []historyFile{}}
	for _, c := range changes {
		was, is := c.PreviousPath != "" && open.readable(c.PreviousPath, pulled), open.readable(c.Path, pulled)
		switch {
		case c.Kind == "renamed" && was && !is:
			answer.Files = append(answer.Files, historyFile{Path: c.PreviousPath, Kind: "deleted"})
		case c.Kind == "renamed" && !was && is:
			answer.Files = append(answer.Files, historyFile{Path: c.Path, Kind: "added"})
		case is:
			answer.Files = append(answer.Files, historyFile{Path: c.Path, PreviousPath: c.PreviousPath, Kind: c.Kind})
		}
	}
	cache(w, open.dir == "")
	reply(w, answer)
}

// answered is whether err is nil; else it answered the request: 404 for a commit or cursor the clone does
// not know, 502 for anything else.
func answered(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return true
	case errors.Is(err, plumbing.ErrObjectNotFound) || errors.Is(err, errBadCursor):
		http.Error(w, "Not found", http.StatusNotFound)
	default:
		http.Error(w, failureMessage(err), http.StatusBadGateway)
	}
	return false
}

func reply(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

// people are who made c, by name: its author (unless Zwiebelfisch), then its co-authors, each once.
func people(c CommitInfo) []string {
	names := []string{}
	for _, p := range append([]Signature{c.Author}, parseCoAuthors(c.Message)...) {
		if p.Name != nobody && !slices.Contains(names, p.Name) {
			names = append(names, p.Name)
		}
	}
	return names
}

// readScope is the room's base commit and its pulled-in files.
func (r *room) readScope() (sha string, pulled []string) {
	r.host.Do(func(doc *ydoc.Doc) {
		if b := readMeta(doc); b != nil {
			sha = b.Sha
		}
		pulled = readPulledIn(doc)
	})
	return sha, pulled
}

// readable is whether the room's clients may read path ("/a.typ") of the repository: it is in the room's
// folder, or pulled in.
func (r *room) readable(path string, pulled []string) bool {
	return r.inFolder(path) || slices.Contains(pulled, path)
}

// historyPath is the path ServeHistory lists the commits of, for the asked one: "" the room's folder; false
// when its clients may not read it.
func (r *room) historyPath(asked string, pulled []string) (string, bool) {
	if asked == "" {
		if r.dir == "" {
			return "", true
		}
		return r.dir + "/", true
	}
	trimmed := strings.TrimSuffix(asked, "/")
	if !strings.HasPrefix(trimmed, "/") || !gitPath(trimmed[1:]) {
		return "", false
	}
	if strings.HasSuffix(asked, "/") {
		return asked, r.inFolder(asked)
	}
	return asked, r.readable(asked, pulled)
}

// fileAt is path's content at commit sha, for a file the room's clients may read (false: not that, not
// there, or no such commit).
func (r *room) fileAt(sha, path string) ([]byte, bool, error) {
	_, pulled := r.readScope()
	if !plumbing.IsHash(sha) || !r.readable(path, pulled) {
		return nil, false, nil
	}
	content, ok, err := r.repo.File(sha, path)
	if errors.Is(err, plumbing.ErrObjectNotFound) {
		return nil, false, nil
	}
	return content, ok, err
}
