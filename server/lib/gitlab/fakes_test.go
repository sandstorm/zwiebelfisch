package gitlab

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"sort"
	"sync"
	"time"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// The stand-ins the room tests run against: a repository in memory (what GitLab does for a room, with the
// branch check done right), the collaboration room around a GitLab room, a clock the test moves, and
// clients (as origins of edits).

// fakeRepo is a Repository in memory: one project, its branches, commits with full snapshots. A test acts
// as GitLab's other users and failures: push as a colleague, failNext, unreachable.
type fakeRepo struct {
	mu       sync.Mutex
	commits  map[string]*fakeCommit
	branches map[string]string
	n        int
	calls    []string // "head main", "tree <sha>", "blob <sha>", "commit main"
	// failNext happens to the next commit: a push lands first (under: and the commit goes on top of it,
	// as GitLab's API cannot refuse that), then err is the answer (nil: the commit goes on).
	failNext *failure
	// unreachable: asking for a branch's head or committing fails as when the network is down
	unreachable bool
	// alwaysMove: someone pushes before every commit
	alwaysMove bool
	// access is what a user (by id) may do; unset: everything (a Developer, no protection)
	access map[string]Access
}

type failure struct {
	err   error
	push  map[string]any
	under bool
}

type fakeCommit struct {
	sha, parent, message string
	files                map[string][]byte
}

func newFakeRepo(files map[string]any) *fakeRepo {
	r := &fakeRepo{commits: map[string]*fakeCommit{}, branches: map[string]string{}, access: map[string]Access{}}
	r.branches["main"] = r.record("", files, "Initial commit").sha
	return r
}

// push commits files (string or []byte; nil deletes) on branch as someone else; returns the new sha.
func (r *fakeRepo) push(branch string, files map[string]any) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.record(r.branches[branch], files, "Upstream change")
	r.branches[branch] = c.sha
	return c.sha
}

func (r *fakeRepo) record(parent string, changes map[string]any, message string) *fakeCommit {
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
	c := &fakeCommit{sha: fmt.Sprintf("%x", sum), parent: parent, message: message, files: files}
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

var errUnreachable = errors.New("fetch failed")

func (r *fakeRepo) Head(_ context.Context, branch string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, "head "+branch)
	if r.unreachable {
		return "", errUnreachable
	}
	sha, ok := r.branches[branch]
	if !ok {
		return "", &APIError{Status: 404, Message: "404 Branch Not Found"}
	}
	return sha, nil
}

func (r *fakeRepo) Tree(_ context.Context, sha string) ([]TreeEntry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, "tree "+sha)
	c := r.commits[sha]
	if c == nil {
		return nil, &APIError{Status: 404, Message: "404 Tree Not Found"}
	}
	var entries []TreeEntry
	for path, content := range c.files {
		entries = append(entries, TreeEntry{Path: path, Sha: blobSha(content)})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

func (r *fakeRepo) Blob(_ context.Context, sha string) ([]byte, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, "blob "+sha)
	for _, c := range r.commits {
		for _, content := range c.files {
			if blobSha(content) == sha {
				return content, nil
			}
		}
	}
	return nil, &APIError{Status: 404, Message: "404 Blob Not Found"}
}

func (r *fakeRepo) Commit(_ context.Context, req CommitRequest) (Commit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, "commit "+req.Branch)
	if r.unreachable {
		return Commit{}, errUnreachable
	}
	if r.alwaysMove {
		r.branches[req.Branch] = r.record(r.branches[req.Branch], map[string]any{"/moving.typ": fmt.Sprint(r.n)}, "Upstream change").sha
	}
	if f := r.failNext; f != nil {
		r.failNext = nil
		if f.push != nil {
			pushed := r.record(r.branches[req.Branch], f.push, "Upstream change")
			r.branches[req.Branch] = pushed.sha
			if f.under {
				req.ExpectedHead = pushed.sha
			}
		}
		if f.err != nil {
			return Commit{}, f.err
		}
	}
	head := r.commits[r.branches[req.Branch]]
	if head.sha != req.ExpectedHead {
		return Commit{}, ErrConflict
	}
	changes := map[string]any{}
	for _, a := range req.Actions {
		_, exists := head.files[a.Path]
		switch a.Kind {
		case ActionCreate:
			if exists {
				return Commit{}, &APIError{Status: 400, Message: "A file with this name already exists"}
			}
			changes[a.Path] = a.Content
		case ActionUpdate:
			if !exists {
				return Commit{}, &APIError{Status: 400, Message: "A file with this name doesn't exist"}
			}
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
	c := r.record(head.sha, changes, req.Message)
	r.branches[req.Branch] = c.sha
	return Commit{Sha: c.sha, Parent: head.sha}, nil
}

func (r *fakeRepo) Access(_ context.Context, user, branch string) (Access, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, "access "+user+" "+branch)
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

// fakeHost is the collaboration room around a GitLab room: one document, run under a lock.
type fakeHost struct {
	mu       sync.Mutex
	doc      *ydoc.Doc
	unloaded bool

	sentMu sync.Mutex
	sent   []message
	empty  bool
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

// testClient is a client as the origin of its edits (a collab.Peer in the server).
type testClient struct {
	name, email string
}

func (c *testClient) Name() string      { return c.name }
func (c *testClient) User() collab.User { return collab.User{Name: c.name, Email: c.email} }
