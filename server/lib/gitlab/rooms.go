// Package gitlab makes rooms backed by a GitLab branch: people edit the branch together in the browser, and
// the server commits it back (on a save, or by itself) and merges what others push.
//
// Rooms opens the rooms named `gitlab:<project id or path>@<branch>`, or `…@<branch>:/<folder>` for a room
// of one folder of the branch, and serves, next to the WebSocket:
//   - a room's files (images, data): GET /rooms/<room>/files/<path>, also at a commit (?ref=)
//   - the history of a room's branch: GET /rooms/<room>/history, GET /rooms/<room>/compare (history.go)
//   - GitLab's push webhook: POST /gitlab/webhook
//
// Everything is done in a signed-in user's name, with their OAuth token (Options.Token; the server holds no
// GitLab token of its own):
//   - who may join and save: asked with that user's token (access.go)
//   - a room loads with the token of who opens it, merges a push with the token of someone in it
//   - a save commits with the saver's token, an auto-save with an editor's: that user is the commit's
//     author, the other editors are Co-authored-by trailers, the committer is Zwiebelfisch
//
// Each project's repository is a git clone in Options.Dir (git.go); tokens never go into it.
package gitlab

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// DefaultID is the provider id of GitLab rooms unless Options.ID says otherwise.
const DefaultID = "gitlab"

// Options configure Rooms. URL and Token are required.
type Options struct {
	// ID is the provider id: the prefix of room names (`<ID>:<project>@<branch>[:/<folder>]`), and the
	// provider of the users it lets in (their collab.User.ID is a user id of this instance). Default
	// DefaultID.
	ID string
	// URL is the GitLab instance, e.g. https://gitlab.com.
	URL string
	// Token is the OAuth access token (scopes read_api, write_repository) of the signed-in user with this
	// instance's user id user, from any live sign-in; an error when they have none (package auth's
	// Auth.Token). It keeps tokens out of its errors.
	Token func(ctx context.Context, user string) (string, error)
	// SignedIn are the user ids of this instance's users signed in now (package auth's Auth.SignedInUsers):
	// whom MayEdit asks for a user who is signed out. nil: nobody.
	SignedIn func() []string
	// Dir is the folder of the projects' git clones, one folder each; "": in memory (gone with the process).
	Dir string
	// Client makes the requests to GitLab (default: one with a 30 s timeout; git calls use its transport
	// only).
	Client *http.Client
	// Authenticate decides who may read a room's files (as for the WebSocket: the app's check, which
	// includes Authorize).
	Authenticate collab.Authenticate
	// WebhookSecret is what GitLab sends as X-Gitlab-Token with push events (ServeWebhook; "": none).
	WebhookSecret string
	// AuthorEmail is the email of an editor whose email is not known (in a commit's author or
	// Co-authored-by trailers), and of the committer Zwiebelfisch. Default zwiebelfisch@localhost.
	AuthorEmail string
	// AutoCommit is the time without edits after which a room commits its changes by itself (also
	// LeaveDelay after the last user left); 0: never, only "Save to GitLab…". See ParseAutoCommit.
	AutoCommit time.Duration
	Log        zerolog.Logger

	repository func(project string) Repository                                                // tests: instead of git clones
	access     func(ctx context.Context, token, project, branch, user string) (Access, error) // tests: instead of GitLab's API
	clock      clock                                                                          // tests: instead of time
}

// Rooms are the GitLab rooms of a server. Create them with New, pass them as collab.Options.Extension, mount
// ServeFile and ServeWebhook (package app); Close them after the collab server.
type Rooms struct {
	opts        Options
	prefix      string
	authorEmail string
	autoCommit  time.Duration
	leaveDelay  time.Duration
	accessCache accessCache
	seeds       seeds // new folders' files, until their room opens (browse.go)
	clock       clock
	log         zerolog.Logger
	ctx         context.Context // ends with Close: repository calls and waits
	cancel      context.CancelFunc

	mu            sync.Mutex
	repos         map[string]Repository // by project
	open          map[string]*room      // by room name
	autoCommitOff map[string]bool       // rooms that never commit by themselves (SetAutoCommit), by room name
	closed        bool
	tasks         sync.WaitGroup
}

// New returns the GitLab rooms for opts.
func New(opts Options) *Rooms {
	if opts.ID == "" {
		opts.ID = DefaultID
	}
	if opts.AuthorEmail == "" {
		opts.AuthorEmail = "zwiebelfisch@localhost"
	}
	if opts.Client == nil {
		opts.Client = &http.Client{Timeout: 30 * time.Second}
	}
	gitlab := api{instance: opts.URL, client: opts.Client}
	if opts.repository == nil {
		committer := Signature{Name: nobody, Email: opts.AuthorEmail}
		opts.repository = func(p string) Repository {
			dir := ""
			if opts.Dir != "" {
				dir = filepath.Join(opts.Dir, "p-"+url.PathEscape(p)) // never "." or ".."
			}
			return newGitRepo(p, dir, gitlab, committer)
		}
	}
	if opts.access == nil {
		opts.access = gitlab.userAccess
	}
	if opts.clock == nil {
		opts.clock = realClock{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	x := &Rooms{
		opts: opts, prefix: opts.ID + ":", authorEmail: opts.AuthorEmail, autoCommit: opts.AutoCommit,
		leaveDelay: LeaveDelay, accessCache: accessCache{entries: map[accessKey]cachedAccess{}},
		clock: opts.clock, log: opts.Log, ctx: ctx, cancel: cancel,
		repos: map[string]Repository{}, open: map[string]*room{}, autoCommitOff: map[string]bool{},
	}
	return x
}

// LeaveDelay is how long a room waits after the last user left before it commits by itself (they may be
// back: a reload).
const LeaveDelay = 20 * time.Second

// DefaultAutoCommit is the auto-commit time when nothing is configured.
const DefaultAutoCommit = 10 * time.Minute

// ParseAutoCommit reads the auto-commit setting (ZWF_GITLAB_AUTO_COMMIT): "off" (or "false", "0") is 0,
// a number is minutes (fractions allowed), "" is DefaultAutoCommit.
func ParseAutoCommit(value string) (time.Duration, error) {
	text := strings.ToLower(strings.TrimSpace(value))
	switch text {
	case "":
		return DefaultAutoCommit, nil
	case "off", "false", "0":
		return 0, nil
	}
	minutes, err := strconv.ParseFloat(text, 64)
	if err != nil || !(minutes > 0 && minutes <= 1e6) { // also NaN
		return 0, fmt.Errorf("ZWF_GITLAB_AUTO_COMMIT: \"off\" or minutes, not %q", value)
	}
	return time.Duration(minutes * float64(time.Minute)), nil
}

// Open makes a room named `<ID>:<project>@<branch>[:/<folder>]` a GitLab room: a new one loads the branch
// (the folder's files), a stored one merges what was pushed meanwhile, with the token of by (who opens it).
// Other rooms are left alone.
func (x *Rooms) Open(r *collab.Room, doc *ydoc.Doc, by collab.User) (collab.Handler, error) {
	g, err := x.openRoom(r.Name(), r, doc, by)
	if g == nil {
		return nil, err // not a nil *room in a non-nil Handler
	}
	return g, err
}

// openRoom opens the room name in h as by (nil: not a GitLab room).
func (x *Rooms) openRoom(name string, h host, doc *ydoc.Doc, by collab.User) (*room, error) {
	project, branch, dir, ok := x.parseRoomName(name)
	if !ok {
		return nil, nil
	}
	g := &room{x: x, host: h, repo: x.repository(project), name: name, project: project, branch: branch, dir: dir}
	if err := g.open(x.ctx, doc, by); err != nil {
		return nil, fmt.Errorf("gitlab: open %s@%s: %w", project, branch, err)
	}
	x.mu.Lock()
	x.open[name] = g
	x.mu.Unlock()
	return g, nil
}

// repository is project's repository, one for all its rooms.
func (x *Rooms) repository(project string) Repository {
	x.mu.Lock()
	defer x.mu.Unlock()
	r := x.repos[project]
	if r == nil {
		r = x.opts.repository(project)
		x.repos[project] = r
	}
	return r
}

// SignedOut: user signs out (call it before their sign-in and its token end). Each open room with edits
// of theirs not committed yet commits them as an auto-save would, in their name if the rules let it; it
// returns when done.
func (x *Rooms) SignedOut(user collab.User) {
	x.mu.Lock()
	var rooms []*room
	for _, r := range x.open {
		rooms = append(rooms, r)
	}
	x.mu.Unlock()
	for _, r := range rooms {
		x.task(func() {
			if r.autoCommit() > 0 && r.hasEditsBy(user) {
				r.autoCommitNow(user)
			}
		})
	}
}

// SetAutoCommit turns committing by itself off (or back to Options.AutoCommit) for the room name, open or
// not (yet): its meta.autoCommit follows, so the widget asks before the last user leaves with changes. For
// the demo playground, which tries both settings on one server.
func (x *Rooms) SetAutoCommit(name string, off bool) {
	x.mu.Lock()
	if off {
		x.autoCommitOff[name] = true
	} else {
		delete(x.autoCommitOff, name)
	}
	open := x.open[name]
	x.mu.Unlock()
	if open != nil {
		open.host.Do(open.autoCommitChanged)
	}
}

// autoCommitOf is the room name's auto-commit time (0: never).
func (x *Rooms) autoCommitOf(name string) time.Duration {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.autoCommitOff[name] {
		return 0
	}
	return x.autoCommit
}

// Handles reports whether room is one of these rooms' names (`<ID>:<project>@<branch>[:/<folder>]`).
func (x *Rooms) Handles(room string) bool {
	_, _, _, ok := x.parseRoomName(room)
	return ok
}

// parseRoomName splits `<ID>:<project id or path>@<branch>[:/<folder>]` (git takes no ':' in a branch's
// name); dir is the folder ("/report/2026": absolute, no empty, ".", ".." or ".git" part), "" without one.
func (x *Rooms) parseRoomName(name string) (project, branch, dir string, ok bool) {
	rest, ok := strings.CutPrefix(name, x.prefix)
	if !ok {
		return "", "", "", false
	}
	project, rest, _ = strings.Cut(rest, "@")
	branch, dir, pinned := strings.Cut(rest, ":")
	if project == "" || branch == "" || (pinned && (!strings.HasPrefix(dir, "/") || !gitPath(dir[1:]))) {
		return "", "", "", false
	}
	return project, branch, dir, true
}

// Close ends the rooms' repository calls and waits for their work (call it after the collab server's Close,
// which unloads the rooms).
func (x *Rooms) Close() {
	x.mu.Lock()
	x.closed = true
	x.mu.Unlock()
	x.cancel()
	x.tasks.Wait()
}

// task runs fn as tracked work (Close waits for it); not at all once closed.
func (x *Rooms) task(fn func()) {
	x.mu.Lock()
	if x.closed {
		x.mu.Unlock()
		return
	}
	x.tasks.Add(1)
	x.mu.Unlock()
	defer x.tasks.Done()
	fn()
}

// goTask runs fn as tracked work on a goroutine of its own.
func (x *Rooms) goTask(fn func()) {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.closed {
		return
	}
	x.tasks.Add(1)
	go func() {
		defer x.tasks.Done()
		fn()
	}()
}

// sleep waits for d; false if ctx or Rooms ended first.
func (x *Rooms) sleep(ctx context.Context, d time.Duration) bool {
	done := make(chan struct{})
	stop := x.clock.AfterFunc(d, func() { close(done) })
	select {
	case <-done:
		return true
	case <-ctx.Done():
	case <-x.ctx.Done():
	}
	stop()
	return false
}

func (x *Rooms) forget(r *room) {
	x.mu.Lock()
	defer x.mu.Unlock()
	for name, open := range x.open {
		if open == r {
			delete(x.open, name)
		}
	}
}

// client is who makes a change of a room's document: a collab.Peer.
type client interface {
	Name() string
	User() collab.User
}

// editorOf is who made a change, by its origin (nil: unknown). A user without a name is named nobody.
func (x *Rooms) editorOf(origin any) *person {
	c, ok := origin.(client)
	if !ok {
		return nil
	}
	user, name := c.User(), c.Name()
	if name == "" && user.ID == "" {
		return nil
	}
	if name == "" {
		name = nobody
	}
	return x.person(user, name, user.Email)
}

// person is user as an editor named name (email "": AuthorEmail).
func (x *Rooms) person(user collab.User, name, email string) *person {
	if email == "" {
		email = x.authorEmail
	}
	return &person{User: user, Name: name, Email: email}
}

// ServeFile answers a file of an open room (the pattern's {room} and {path...}) to whom Authenticate lets in:
// as the room has it, or with ?ref=<sha> as it is at that commit (a file the room holds or pulled in only;
// cached for good). CORS is the app's.
//
// Every answer is passive content: nosniff and a sandboxing CSP (no script runs, also in an SVG opened as
// a page); images, PDF, fonts and text files are served inline under their type (text as text/plain),
// anything else as an application/octet-stream attachment.
func (x *Rooms) ServeFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
	open, _ := x.openFor(w, r)
	if open == nil {
		return
	}
	file, ref := "/"+r.PathValue("path"), r.URL.Query().Get("ref")
	var content []byte
	var ok bool
	var err error
	if ref == "" {
		content, ok, err = open.asset(file)
	} else {
		content, ok, err = open.fileAt(ref, file)
	}
	if err != nil {
		http.Error(w, failureMessage(err), http.StatusBadGateway)
		return
	}
	if !ok {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if t, inline := passiveTypes[strings.ToLower(path.Ext(file))]; inline {
		w.Header().Set("Content-Type", t)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", "attachment")
	}
	cache(w, ref != "")
	_, _ = w.Write(content)
}

// openFor is the open room the request's {room} names and the user Authenticate lets in; else nil, the
// refusal answered (401, or 404 for a room not open).
func (x *Rooms) openFor(w http.ResponseWriter, r *http.Request) (*room, collab.User) {
	name := r.PathValue("room")
	if x.opts.Authenticate == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return nil, collab.User{}
	}
	user, err := x.opts.Authenticate(r, name)
	if err != nil { // first: whether a room is open is no one else's business
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return nil, collab.User{}
	}
	x.mu.Lock()
	open := x.open[name]
	x.mu.Unlock()
	if open == nil {
		http.Error(w, "Not found", http.StatusNotFound)
	}
	return open, user
}

// cache sets an answer's Cache-Control: kept for good (immutable: it names a commit), else asked again each
// time.
func cache(w http.ResponseWriter, immutable bool) {
	if immutable {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "private, no-cache")
	}
}

// passiveTypes are the files ServeFile answers inline, by extension: what a Typst document reads (images,
// fonts, data) and PDF.
var passiveTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
	".avif": "image/avif", ".svg": "image/svg+xml", ".pdf": "application/pdf",
	".ttf": "font/ttf", ".otf": "font/otf", ".ttc": "font/collection", ".woff": "font/woff", ".woff2": "font/woff2",
	".typ": textPlain, ".txt": textPlain, ".bib": textPlain, ".csv": textPlain, ".json": textPlain,
	".yaml": textPlain, ".yml": textPlain, ".toml": textPlain, ".xml": textPlain, ".md": textPlain,
}

const textPlain = "text/plain; charset=utf-8"

// ServeWebhook takes GitLab's push events, with X-Gitlab-Token (WebhookSecret; none without it), and merges
// a push into the open rooms of that branch.
func (x *Rooms) ServeWebhook(w http.ResponseWriter, r *http.Request) {
	if x.opts.WebhookSecret == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Gitlab-Token")), []byte(x.opts.WebhookSecret)) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	var event struct {
		ObjectKind string `json:"object_kind"`
		Ref        string `json:"ref"`
		ProjectID  *int64 `json:"project_id"`
		Project    struct {
			ID                *int64 `json:"id"`
			PathWithNamespace string `json:"path_with_namespace"`
		} `json:"project"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 25<<20)).Decode(&event); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	branch, isBranch := strings.CutPrefix(event.Ref, "refs/heads/")
	if event.ObjectKind != "push" || !isBranch {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("Ignored"))
		return
	}
	var projects []string
	if id := event.ProjectID; id != nil || event.Project.ID != nil {
		if id == nil {
			id = event.Project.ID
		}
		projects = append(projects, strconv.FormatInt(*id, 10))
	}
	if event.Project.PathWithNamespace != "" {
		projects = append(projects, event.Project.PathWithNamespace)
	}
	x.pushed(x.ctx, projects, branch) // not the request's: a merge begun is finished
	w.WriteHeader(http.StatusAccepted)
	_, _ = w.Write([]byte("Accepted"))
}

// pushed merges a push into the open rooms of that branch and tells their clients, each fetched with the
// token of someone in it; a room with nobody signed in fetches it when someone joins (Authorize).
func (x *Rooms) pushed(ctx context.Context, projects []string, branch string) {
	x.mu.Lock()
	var affected []*room
	for _, r := range x.open {
		if r.branch == branch && slices.Contains(projects, r.project) {
			affected = append(affected, r)
		}
	}
	x.mu.Unlock()
	var wg sync.WaitGroup
	for _, r := range affected {
		wg.Add(1)
		go func() {
			defer wg.Done()
			x.task(func() {
				for _, user := range r.host.Users() {
					if token, err := x.token(ctx, user); err == nil {
						r.pullWith(ctx, token)
						return
					}
				}
				r.stale.Store(true)
			})
		}()
	}
	wg.Wait()
}

// clock is time as rooms see it (tests have their own).
type clock interface {
	Now() time.Time
	// AfterFunc calls f on a goroutine of its own after d, unless stop is called first.
	AfterFunc(d time.Duration, f func()) (stop func() bool)
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) AfterFunc(d time.Duration, f func()) func() bool { return time.AfterFunc(d, f).Stop }
