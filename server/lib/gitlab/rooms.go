// Package gitlab makes rooms backed by a GitLab branch: people edit the branch together in the browser, and
// the server commits it back (on a save, or by itself) and merges what others push.
//
// Rooms is the collab.Extension for room names `gitlab:<project id or path>@<branch>` (the widget's format;
// `gitlab` is the provider id, the seam for other instances and providers); other rooms are left alone.
// It also answers the HTTP endpoints next to the WebSocket: a room's files (images, data) and GitLab's push
// webhook. The room logic (room.go) works against a Repository (repository.go); api.go is GitLab's REST
// API behind it. Commits are made with the server's bot token: the bot is the author, the editors are
// Co-authored-by trailers. No user token is used or kept here.
//
// See docs/40_architecture/09_server.typ, "GitLab rooms".
package gitlab

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/ydoc"
)

// Options configure Rooms. URL and Token are required.
type Options struct {
	// ID is the provider id: the prefix of room names (`<ID>:<project>@<branch>`) and of the webhook path
	// (`/<ID>/webhook`). Default "gitlab".
	ID string
	// URL is the GitLab instance, e.g. https://gitlab.com; Token a bot token with `api` scope (server-side,
	// never sent to clients): the author of every commit.
	URL, Token string
	// Client makes the REST calls (default: one with a 30 s timeout).
	Client *http.Client
	// Authenticate decides who may read a room's files (the room's token, as for the WebSocket).
	Authenticate collab.Authenticate
	// WebhookSecret is what GitLab sends as X-Gitlab-Token with push events ("": no webhook endpoint).
	WebhookSecret string
	// AuthorEmail is the email of an editor whose email is not known (in Co-authored-by trailers). Default
	// typst-editor@localhost.
	AuthorEmail string
	// AutoCommit is the time without edits after which a room commits its changes by itself (also
	// LeaveDelay after the last user left); 0: never, only "Save to GitLab…". See ParseAutoCommit.
	AutoCommit time.Duration
	Log        zerolog.Logger

	repository func(project string) Repository // tests: instead of GitLab's API
	clock      clock                           // tests: instead of time
}

// Rooms are the GitLab rooms of a server. Create them with New, pass them as collab.Options.Extension and
// mount them as the http.Handler of /rooms/ and /<ID>/webhook; Close them after the collab server.
type Rooms struct {
	opts        Options
	prefix      string
	authorEmail string
	autoCommit  time.Duration
	leaveDelay  time.Duration
	blobs       *blobCache
	clock       clock
	log         zerolog.Logger
	http        *http.ServeMux
	ctx         context.Context // ends with Close: repository calls and waits
	cancel      context.CancelFunc

	mu     sync.Mutex
	open   map[string]*room // by room name
	closed bool
	tasks  sync.WaitGroup
}

// New returns the GitLab rooms for opts.
func New(opts Options) *Rooms {
	if opts.ID == "" {
		opts.ID = "gitlab"
	}
	if opts.AuthorEmail == "" {
		opts.AuthorEmail = "typst-editor@localhost"
	}
	if opts.Client == nil {
		opts.Client = &http.Client{Timeout: 30 * time.Second}
	}
	if opts.repository == nil {
		opts.repository = func(p string) Repository { return newProject(opts.URL, opts.Token, p, opts.Client) }
	}
	if opts.clock == nil {
		opts.clock = realClock{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	x := &Rooms{
		opts: opts, prefix: opts.ID + ":", authorEmail: opts.AuthorEmail, autoCommit: opts.AutoCommit,
		leaveDelay: LeaveDelay, blobs: newBlobCache(64 << 20), clock: opts.clock, log: opts.Log,
		ctx: ctx, cancel: cancel, open: map[string]*room{},
	}
	x.http = http.NewServeMux()
	x.http.HandleFunc("GET /rooms/{room}/files/{path...}", x.serveFile)
	x.http.HandleFunc("OPTIONS /rooms/{room}/files/{path...}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization")
		w.WriteHeader(http.StatusNoContent)
	})
	if opts.WebhookSecret != "" {
		x.http.HandleFunc("POST /"+opts.ID+"/webhook", x.serveWebhook)
	}
	return x
}

// LeaveDelay is how long a room waits after the last user left before it commits by itself (they may be
// back: a reload).
const LeaveDelay = 20 * time.Second

// DefaultAutoCommit is the auto-commit time when nothing is configured.
const DefaultAutoCommit = 10 * time.Minute

// ParseAutoCommit reads the auto-commit setting (TYPST_GITLAB_AUTO_COMMIT): "off" (or "false", "0") is 0,
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
		return 0, fmt.Errorf("TYPST_GITLAB_AUTO_COMMIT: \"off\" or minutes, not %q", value)
	}
	return time.Duration(minutes * float64(time.Minute)), nil
}

// Open makes a room named `<ID>:<project>@<branch>` a GitLab room: a new one loads the branch, a stored
// one merges what was pushed meanwhile. Other rooms are left alone.
func (x *Rooms) Open(r *collab.Room, doc *ydoc.Doc) (collab.Handler, error) {
	g, err := x.openRoom(r.Name(), r, doc)
	if g == nil {
		return nil, err // not a nil *room in a non-nil Handler
	}
	return g, err
}

// openRoom opens the room name in h (nil: not a GitLab room).
func (x *Rooms) openRoom(name string, h host, doc *ydoc.Doc) (*room, error) {
	project, branch, ok := x.parseRoomName(name)
	if !ok {
		return nil, nil
	}
	g := &room{x: x, host: h, repo: x.opts.repository(project), project: project, branch: branch}
	if err := g.open(x.ctx, doc); err != nil {
		return nil, fmt.Errorf("gitlab: open %s@%s: %w", project, branch, err)
	}
	x.mu.Lock()
	x.open[name] = g
	x.mu.Unlock()
	return g, nil
}

// parseRoomName splits `<ID>:<project id or path>@<branch>`.
func (x *Rooms) parseRoomName(name string) (project, branch string, ok bool) {
	rest, ok := strings.CutPrefix(name, x.prefix)
	if !ok {
		return "", "", false
	}
	at := strings.IndexByte(rest, '@')
	if at <= 0 || at == len(rest)-1 {
		return "", "", false
	}
	return rest[:at], rest[at+1:], true
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

// editorOf is who made a change, by its origin (nil: unknown).
func (x *Rooms) editorOf(origin any) *person {
	c, ok := origin.(client)
	if !ok || c.Name() == "" {
		return nil
	}
	email := c.User().Email
	if email == "" {
		email = x.authorEmail
	}
	return &person{c.Name(), email}
}

// ServeHTTP answers GET /rooms/<room>/files/<path> (a file of an open room, with the room's token as
// `Authorization: Bearer <token>`; blob bytes are cached by sha) and POST /<ID>/webhook (GitLab push events
// with X-Gitlab-Token; merges the push into the open rooms of that branch).
func (x *Rooms) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	x.http.ServeHTTP(w, r)
}

func (x *Rooms) serveFile(w http.ResponseWriter, r *http.Request) {
	name, file := r.PathValue("room"), "/"+r.PathValue("path")
	x.mu.Lock()
	open := x.open[name]
	x.mu.Unlock()
	if open == nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if x.opts.Authenticate == nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if _, err := x.opts.Authenticate(strings.TrimSpace(token), name); err != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	content, ok, err := open.asset(r.Context(), file)
	if err != nil {
		http.Error(w, failureMessage(err), http.StatusBadGateway)
		return
	}
	if !ok {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", contentType(file))
	w.Header().Set("Cache-Control", "private, no-cache")
	_, _ = w.Write(content)
}

func contentType(file string) string {
	ext := strings.ToLower(path.Ext(file))
	if t, ok := imageTypes[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}

var imageTypes = map[string]string{
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
	".svg": "image/svg+xml", ".webp": "image/webp", ".pdf": "application/pdf",
}

func (x *Rooms) serveWebhook(w http.ResponseWriter, r *http.Request) {
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Gitlab-Token")), []byte(x.opts.WebhookSecret)) != 1 {
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

// pushed merges a push into the open rooms of that branch and tells their clients.
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
				result, err := r.pull(ctx)
				r.logErr(err, "cannot merge the push")
				if result != nil {
					r.host.BroadcastStateless(result.json())
				}
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
