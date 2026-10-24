package gitlab

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v6/plumbing"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// The stand-ins the room tests run against: a repository in memory (what GitLab does for a room, with the
// branch check done right), the collaboration room around a GitLab room, a clock the test moves, and
// clients (as origins of edits).

// fakeRepo is a Repository in memory: one project, its branches, commits with full snapshots, and what its
// users may do (the access hook). A test acts as GitLab's other users and failures: push as a colleague,
// failNext, unreachable.
type fakeRepo struct {
	mu       sync.Mutex
	commits  map[string]*fakeCommit
	branches map[string]string
	n        int
	calls    []string // "head main", "blobs <sha>…" (read locally), "commit main", "access <user> main"
	tokens   []string // the token of each call that talks to GitLab
	// failNext happens to the next commit: a push lands first, then err is the answer (nil: the commit
	// goes on, and is refused as the branch moved)
	failNext *failure
	// unreachable: fetching, committing and asking for access fail as when the network is down
	unreachable bool
	// alwaysMove: someone pushes before every commit
	alwaysMove bool
	// access is what a user (by id) may do; unset: everything (a Developer, no protection)
	access map[string]Access
}

type failure struct {
	err  error
	push map[string]any
}

type fakeCommit struct {
	sha, parent, message string
	author               Signature
	files                map[string][]byte
}

func newFakeRepo(files map[string]any) *fakeRepo {
	r := &fakeRepo{commits: map[string]*fakeCommit{}, branches: map[string]string{}, access: map[string]Access{}}
	r.branches["main"] = r.record("", files, "Initial commit", Signature{"Upstream", "upstream@test"}).sha
	return r
}

// push commits files (string or []byte; nil deletes) on branch as someone else; returns the new sha.
func (r *fakeRepo) push(branch string, files map[string]any) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.record(r.branches[branch], files, "Upstream change", Signature{"Upstream", "upstream@test"})
	r.branches[branch] = c.sha
	return c.sha
}

func (r *fakeRepo) record(parent string, changes map[string]any, message string, author Signature) *fakeCommit {
	files := map[string][]byte{}
	if p := r.commits[parent]; p != nil {
		maps.Copy(files, p.files)
	}
	for path, content := range changes {
		switch c := content.(type) {
		case nil:
			delete(files, path)
		case string:
			files[path] = []byte(c)
		case []byte:
			files[path] = c
		}
	}
	r.n++
	sum := sha1.Sum(fmt.Appendf(nil, "commit %d %s", r.n, parent))
	c := &fakeCommit{sha: fmt.Sprintf("%x", sum), parent: parent, message: message, author: author, files: files}
	r.commits[c.sha] = c
	return c
}

func (r *fakeRepo) head(branch string) *fakeCommit {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.commits[r.branches[branch]]
}

// texts are the files of main as text.
func (r *fakeRepo) texts() map[string]string {
	texts := map[string]string{}
	for path, content := range r.head("main").files {
		texts[path] = string(content)
	}
	return texts
}

func (r *fakeRepo) count(call string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, c := range r.calls {
		if c == call {
			n++
		}
	}
	return n
}

// called records a call with token. Called with mu held.
func (r *fakeRepo) called(call, token string) {
	r.calls = append(r.calls, call)
	r.tokens = append(r.tokens, token)
}

// usedTokens are the tokens of the calls so far, and forgets them.
func (r *fakeRepo) usedTokens() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	used := r.tokens
	r.tokens = nil
	return used
}

var errUnreachable = errors.New("fetch failed")

func (r *fakeRepo) Head(_ context.Context, token, branch string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.called("head "+branch, token)
	if r.unreachable {
		return "", errUnreachable
	}
	sha, ok := r.branches[branch]
	if !ok {
		return "", &APIError{Status: 404, Message: "GitLab has no branch " + branch}
	}
	return sha, nil
}

func (r *fakeRepo) Tree(sha string) ([]TreeEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commits[sha]
	if c == nil {
		return nil, errors.New("object not found")
	}
	var entries []TreeEntry
	for path, content := range c.files {
		entries = append(entries, TreeEntry{Path: path, Sha: blobSha(content)})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

func (r *fakeRepo) Blobs(shas []string) ([][]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(shas) == 0 {
		return nil, nil
	}
	r.calls = append(r.calls, "blobs "+strings.Join(shas, " ")) // no GitLab call: no token
	out := make([][]byte, len(shas))
	for i, sha := range shas {
		found := false
		for _, c := range r.commits {
			for _, content := range c.files {
				if blobSha(content) == sha {
					out[i], found = content, true
				}
			}
		}
		if !found {
			return nil, errors.New("object not found")
		}
		if len(out[i]) > maxBlobSize {
			return nil, errTooLarge
		}
	}
	return out, nil
}

func (r *fakeRepo) Commit(_ context.Context, token string, req CommitRequest) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.called("commit "+req.Branch, token)
	if r.unreachable {
		return "", errUnreachable
	}
	if r.alwaysMove {
		r.branches[req.Branch] = r.record(r.branches[req.Branch], map[string]any{"/moving.typ": fmt.Sprint(r.n)}, "Upstream change", Signature{}).sha
	}
	if f := r.failNext; f != nil {
		r.failNext = nil
		if f.push != nil {
			r.branches[req.Branch] = r.record(r.branches[req.Branch], f.push, "Upstream change", Signature{}).sha
		}
		if f.err != nil {
			return "", f.err
		}
	}
	head := r.commits[r.branches[req.Branch]]
	if head.sha != req.ExpectedHead {
		return "", ErrConflict
	}
	changes := map[string]any{}
	for _, a := range req.Actions {
		switch a.Kind {
		case ActionCreate, ActionUpdate:
			changes[a.Path] = a.Content
		case ActionDelete:
			changes[a.Path] = nil
		case ActionMove:
			content := head.files[a.PreviousPath]
			if a.Content != nil {
				content = a.Content
			}
			changes[a.PreviousPath], changes[a.Path] = nil, content
		}
	}
	c := r.record(head.sha, changes, req.Message, req.Author)
	r.branches[req.Branch] = c.sha
	return c.sha, nil
}

func (r *fakeRepo) Log(q LogQuery) ([]CommitInfo, string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	from, skip := q.Sha, 0
	if q.Cursor != "" {
		var ok bool
		if from, skip, ok = parseLogCursor(q.Cursor); !ok {
			return nil, "", errBadCursor
		}
	}
	if r.commits[from] == nil {
		return nil, "", plumbing.ErrObjectNotFound
	}
	var out []CommitInfo
	walked := 0
	for c := r.commits[from]; c != nil; c = r.commits[c.parent] {
		if walked++; walked <= skip || !r.changes(c, q.Path) {
			continue
		}
		info := CommitInfo{Sha: c.sha, Message: c.message, Author: c.author, At: time.UnixMilli(int64(walked))}
		if c.parent != "" {
			info.Parents = []string{c.parent}
		}
		if out = append(out, info); len(out) >= q.Limit {
			return out, logCursor(from, walked), nil
		}
	}
	return out, "", nil
}

// changes is whether c changed a file at p ("" any, "/dir/" in a folder, "/a.typ" that file). Called with mu
// held.
func (r *fakeRepo) changes(c *fakeCommit, p string) bool {
	var before map[string][]byte
	if parent := r.commits[c.parent]; parent != nil {
		before = parent.files
	}
	in := func(path string) bool {
		return p == "" || path == p || (strings.HasSuffix(p, "/") && strings.HasPrefix(path, p))
	}
	for _, files := range []map[string][]byte{c.files, before} {
		for path := range files {
			if in(path) && string(c.files[path]) != string(before[path]) {
				return true
			}
		}
	}
	return false
}

func (r *fakeRepo) Compare(from, sha string) ([]FileChange, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commits[sha]
	if c == nil {
		return nil, plumbing.ErrObjectNotFound
	}
	if from == "" {
		from = c.parent
	} else if r.commits[from] == nil {
		return nil, plumbing.ErrObjectNotFound
	}
	var before map[string][]byte
	if base := r.commits[from]; base != nil {
		before = base.files
	}
	var out []FileChange
	for path, content := range c.files {
		if old, ok := before[path]; !ok {
			out = append(out, FileChange{Path: path, Kind: "added"})
		} else if string(old) != string(content) {
			out = append(out, FileChange{Path: path, Kind: "modified"})
		}
	}
	for path := range before {
		if _, ok := c.files[path]; !ok {
			out = append(out, FileChange{Path: path, Kind: "deleted"})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (r *fakeRepo) File(sha, path string) ([]byte, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.commits[sha]
	if c == nil {
		return nil, false, plumbing.ErrObjectNotFound
	}
	content, ok := c.files[path]
	return content, ok, nil
}

// Access is the access hook: what user may do (setAccess), asked with token.
func (r *fakeRepo) Access(_ context.Context, token, _, branch, user string) (Access, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.called("access "+user+" "+branch, token)
	if r.unreachable {
		return Access{}, errUnreachable
	}
	if a, ok := r.access[user]; ok {
		return a, nil
	}
	return Access{Role: "Developer", Edit: true, Push: true}, nil
}

// setAccess sets what user may do.
func (r *fakeRepo) setAccess(user string, a Access) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.access[user] = a
}

// fakeTokens are the users' sign-ins: a user (by id) has the token "token-<id>" unless signed out.
type fakeTokens struct {
	mu        sync.Mutex
	signedOut map[string]bool
}

func (f *fakeTokens) Token(_ context.Context, user string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.signedOut[user] {
		return "", errors.New("no sign-in")
	}
	return "token-" + user, nil
}

func (f *fakeTokens) signOut(user string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.signedOut == nil {
		f.signedOut = map[string]bool{}
	}
	f.signedOut[user] = true
}

// fakeHost is the collaboration room around a GitLab room: one document, run under a lock.
type fakeHost struct {
	mu       sync.Mutex
	doc      *ydoc.Doc
	unloaded bool

	sentMu sync.Mutex
	sent   []message
	empty  bool
	users  []collab.User
}

func (h *fakeHost) Do(fn func(doc *ydoc.Doc)) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.unloaded {
		return false
	}
	fn(h.doc)
	return true
}

func (h *fakeHost) BroadcastStateless(payload string) {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	var m message
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		panic("not a message: " + payload)
	}
	h.sent = append(h.sent, m)
}

// Users are who is in the room: those set with setUsers.
func (h *fakeHost) Users() []collab.User {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	return h.users
}

func (h *fakeHost) setUsers(users ...collab.User) {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	h.users = users
}

func (h *fakeHost) Empty() bool {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	return h.empty
}

func (h *fakeHost) setEmpty(empty bool) {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	h.empty = empty
}

// takeSent returns the messages broadcast so far and forgets them.
func (h *fakeHost) takeSent() []message {
	h.sentMu.Lock()
	defer h.sentMu.Unlock()
	sent := h.sent
	h.sent = nil
	return sent
}

// fakeClock is time the test moves (Advance); timers fire in the test's goroutine, so after Advance what
// they started is done.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	at time.Time
	d  time.Duration
	f  func()
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) func() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{at: c.now.Add(d), d: d, f: f}
	c.timers = append(c.timers, t)
	return func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		n := len(c.timers)
		c.timers = slicesDelete(c.timers, t)
		return len(c.timers) < n
	}
}

// pending is whether a timer of duration d waits.
func (c *fakeClock) pending(d time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, t := range c.timers {
		if t.d == d {
			return true
		}
	}
	return false
}

// Advance moves the time by d, firing the timers due on the way (in order).
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	end := c.now.Add(d)
	c.mu.Unlock()
	for {
		c.mu.Lock()
		var next *fakeTimer
		for _, t := range c.timers {
			if !t.at.After(end) && (next == nil || t.at.Before(next.at)) {
				next = t
			}
		}
		if next == nil {
			c.now = end
			c.mu.Unlock()
			return
		}
		c.timers = slicesDelete(c.timers, next)
		c.now = next.at
		c.mu.Unlock()
		next.f()
	}
}

func slicesDelete(timers []*fakeTimer, t *fakeTimer) []*fakeTimer {
	out := timers[:0:0]
	for _, other := range timers {
		if other != t {
			out = append(out, other)
		}
	}
	return out
}

// testClient is a client as the origin of its edits (a collab.Peer in the server): a GitLab user (id "":
// signed in otherwise).
type testClient struct {
	name, email, id string
}

func (c *testClient) Name() string { return c.name }
func (c *testClient) User() collab.User {
	u := collab.User{Name: c.name, Email: c.email, ID: c.id}
	if c.id != "" {
		u.Provider = DefaultID
	}
	return u
}
