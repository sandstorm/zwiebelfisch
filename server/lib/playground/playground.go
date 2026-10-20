// Package playground is the demo playground's server side: GitLab rooms without a real GitLab. Used only by
// server/cmd/fake-gitlab, never in a real deployment.
//
// A fakegitlab.GitLab holds the project and signs people in, and dev-only HTTP endpoints let
//   - the demo's playground bar simulate a colleague's push or a GitLab outage
//   - the tests switch a room's auto-commit
//
// It also reads the demo's repository from disk (ReadProjectFiles) and serves the built demo without Vite
// (StaticFiles).
package playground

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

const (
	// Project is the fake repository's project path.
	Project = "demo/report"
	// Room is the room the demo's GitLab mode opens.
	Room = roomPrefix + Project + "@main"
)

const roomPrefix = "gitlab:"

// Options configure Handler.
type Options struct {
	GitLab *fakegitlab.GitLab
	// AppendTo is the file simulated upstream commits change ("/chapters/introduction.typ").
	AppendTo string
	// Webhook is GitLab rooms' push webhook: every simulated push is delivered to it (with WebhookSecret as
	// X-Gitlab-Token), so an open room merges it right away. Nil: pushes are not announced.
	Webhook       http.Handler
	WebhookSecret string
	// Rooms are the server's GitLab rooms (gitlab.Rooms): /playground/auto-commit switches their setting
	// for one room. Nil: that endpoint answers 404.
	Rooms interface{ SetAutoCommit(room string, off bool) }
}

// Handler answers the playground endpoints and hands every other request to next (the collaboration
// server). The endpoints answer anyone (CORS *), so the demo on another port may call them:
//
//   - GET /oauth/authorize: the fake GitLab's sign-in page (its other sign-in endpoints are in-process;
//     the browser only ever comes here).
//   - GET /playground: {project, room}; tells the demo that this server has the fake GitLab, and which room
//     is its repository.
//   - POST /playground/upstream?room=gitlab:<project>@<branch>[&change=append|heading]: commits a change to
//     that branch, as a colleague pushing would, then delivers GitLab's push webhook. Answers {sha, path, message}.
//   - POST /playground/outage?room=gitlab:<project>@<branch>[&on=false]: GitLab cannot be reached for that
//     branch until called with on=false. Answers {branch, reachable}.
//   - POST /playground/auto-commit?room=gitlab:<project>@<branch>[&on=true]: that room (open or not yet)
//     never commits by itself, until called with on=true (the server's setting, ZWF_GITLAB_AUTO_COMMIT,
//     which the other rooms keep). Answers {room, autoCommit}.
func Handler(opts Options, next http.Handler) http.Handler {
	return &endpoints{opts: opts, next: next}
}

type endpoints struct {
	opts Options
	next http.Handler

	mu      sync.Mutex
	commits int
}

func (e *endpoints) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var handle func(w http.ResponseWriter, r *http.Request)
	method := http.MethodPost
	switch r.URL.Path {
	case "/oauth/authorize":
		e.opts.GitLab.IdentityProvider().ServeHTTP(w, r)
		return
	case "/playground":
		handle, method = e.describe, http.MethodGet
	case "/playground/upstream":
		handle = e.upstream
	case "/playground/outage":
		handle = e.outage
	case "/playground/auto-commit":
		handle = e.autoCommit
	default:
		e.next.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method != method {
		text(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	handle(w, r)
}

func (e *endpoints) describe(w http.ResponseWriter, _ *http.Request) {
	reply(w, map[string]string{"project": Project, "room": Room})
}

func (e *endpoints) outage(w http.ResponseWriter, r *http.Request) {
	branch, ok := e.branch(w, r)
	if !ok {
		return
	}
	reachable := r.URL.Query().Get("on") == "false"
	e.opts.GitLab.SetUnreachable(branch, !reachable)
	reply(w, map[string]any{"branch": branch, "reachable": reachable})
}

func (e *endpoints) autoCommit(w http.ResponseWriter, r *http.Request) {
	if e.opts.Rooms == nil {
		text(w, http.StatusNotFound, "This server has no GitLab rooms")
		return
	}
	if _, ok := e.branch(w, r); !ok {
		return
	}
	room := r.URL.Query().Get("room")
	on := r.URL.Query().Get("on") == "true"
	e.opts.Rooms.SetAutoCommit(room, !on)
	reply(w, map[string]any{"room": room, "autoCommit": on})
}

func (e *endpoints) upstream(w http.ResponseWriter, r *http.Request) {
	branch, ok := e.branch(w, r)
	if !ok {
		return
	}
	change := Append
	if r.URL.Query().Get("change") == string(Heading) {
		change = Heading
	}
	e.mu.Lock()
	e.commits++
	n := e.commits
	e.mu.Unlock()

	gitlab, path := e.opts.GitLab, e.opts.AppendTo
	from := branch
	if !gitlab.HasBranch(branch) {
		from = "main"
	}
	verb := "Add a paragraph"
	if change == Heading {
		verb = "Revise a heading"
	}
	message := fmt.Sprintf("%s (simulated upstream commit %d)", verb, n)
	before := gitlab.Head(branch).SHA
	if before == "" {
		before = strings.Repeat("0", 40) // GitLab's "no commit": the push created the branch
	}
	sha := gitlab.Push(branch, fakegitlab.Files{path: []byte(UpstreamEdit(gitlab.Text(from)[path], change, n))}, message)
	if err := e.deliver(r, branch, before, sha); err != nil {
		text(w, http.StatusBadGateway, err.Error())
		return
	}
	reply(w, map[string]string{"sha": sha, "path": path, "message": message})
}

// branch is the fake GitLab's branch the request names (room=gitlab:<project>@<branch>); else it answers why not.
func (e *endpoints) branch(w http.ResponseWriter, r *http.Request) (string, bool) {
	rest, ok := strings.CutPrefix(r.URL.Query().Get("room"), roomPrefix)
	project, branch, _ := strings.Cut(rest, "@")
	if !ok || project == "" || branch == "" {
		text(w, http.StatusBadRequest, "room must be a GitLab room: gitlab:<project>@<branch>")
		return "", false
	}
	if project != e.opts.GitLab.Project() {
		text(w, http.StatusNotFound, "The fake GitLab has only the project "+e.opts.GitLab.Project())
		return "", false
	}
	return branch, true
}

// deliver sends GitLab's push webhook for branch (now at after) to the Webhook.
func (e *endpoints) deliver(r *http.Request, branch, before, after string) error {
	if e.opts.Webhook == nil {
		return nil
	}
	event, _ := json.Marshal(map[string]any{
		"object_kind": "push", "event_name": "push", "ref": "refs/heads/" + branch,
		"before": before, "after": after, "checkout_sha": after,
		"project": map[string]string{"path_with_namespace": e.opts.GitLab.Project()},
	})
	hook, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "/api/public/gitlab/webhook", bytes.NewReader(event))
	if err != nil {
		return err
	}
	hook.Header.Set("Content-Type", "application/json")
	hook.Header.Set("X-Gitlab-Event", "Push Hook")
	hook.Header.Set("X-Gitlab-Token", e.opts.WebhookSecret)
	rec := httptest.NewRecorder()
	e.opts.Webhook.ServeHTTP(rec, hook)
	if rec.Code >= 300 {
		return fmt.Errorf("push webhook: %d %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	return nil
}

// Change is what a simulated upstream commit does.
type Change string

const (
	// Append adds a paragraph.
	Append Change = "append"
	// Heading revises the first heading (to provoke a conflict with an edit there).
	Heading Change = "heading"
)

var heading = regexp.MustCompile(`(?m)^(=+ [^\n<]*?)(\s*<[^>\n]+>)?$`)

// UpstreamEdit is text after the n-th simulated upstream change. Heading falls back to Append in a file
// without a heading.
func UpstreamEdit(text string, change Change, n int) string {
	if m := heading.FindStringSubmatchIndex(text); change == Heading && m != nil {
		return text[:m[3]] + fmt.Sprintf(" (upstream revision %d)", n) + text[m[3]:]
	}
	paragraph := fmt.Sprintf("Upstream edit %d: a colleague added this paragraph on GitLab.\n", n)
	return strings.TrimRight(text, "\n") + "\n\n" + paragraph
}

func reply(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func text(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(message))
}
