package playground_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/playground"
	"github.com/sandstorm/zwiebelfisch/server/lib/testutil"
)

// The playground's dev-only endpoints, in-process: the fake GitLab, a recording stand-in for GitLab rooms'
// push webhook and for the collaboration server behind. No ports. That an open GitLab room merges the push
// is GitLab rooms' test (package gitlab), with this same webhook request.

const intro = "/chapters/introduction.typ"

func files() fakegitlab.Files {
	return fakegitlab.Files{
		"/main.typ":        []byte("#include \"chapters/introduction.typ\"\n"),
		intro:              []byte("= Introduction <intro>\n\nFirst paragraph.\n"),
		"/assets/logo.svg": []byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`),
	}
}

type setup struct {
	gitlab  *fakegitlab.GitLab
	rooms   *rooms
	handler http.Handler
	hooks   []*http.Request
	bodies  []map[string]any
	behind  int // requests the collaboration server got
}

func newSetup(t *testing.T) *setup {
	s := &setup{gitlab: fakegitlab.New(playground.Project, files()), rooms: &rooms{}}
	s.gitlab.SetAutoBranches(true)
	webhook := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var event map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&event))
		s.hooks, s.bodies = append(s.hooks, r), append(s.bodies, event)
	})
	behind := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { s.behind++ })
	s.handler = playground.Handler(playground.Options{GitLab: s.gitlab, AppendTo: intro, Webhook: webhook, WebhookSecret: "hook-secret", Rooms: s.rooms}, behind)
	return s
}

// rooms records SetAutoCommit (the GitLab rooms' own test checks what it does).
type rooms struct{ calls []string }

func (r *rooms) SetAutoCommit(room string, off bool) {
	r.calls = append(r.calls, fmt.Sprintf("%s off=%t", room, off))
}

func (s *setup) request(t *testing.T, method, target string) (*httptest.ResponseRecorder, map[string]any) {
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	var body map[string]any
	if rec.Header().Get("Content-Type") == "application/json" {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	}
	return rec, body
}

var room = url.QueryEscape(playground.Room)

func TestDescribe(t *testing.T) {
	s := newSetup(t)
	rec, body := s.request(t, "GET", "/playground")
	require.Equal(t, 200, rec.Code)
	require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, map[string]any{"project": "demo/report", "room": "gitlab:demo/report@main"}, body)
}

func TestUpstreamCommitAndWebhook(t *testing.T) {
	s := newSetup(t)
	before := s.gitlab.Head("main").SHA
	rec, body := s.request(t, "POST", "/playground/upstream?room="+room)
	require.Equal(t, 200, rec.Code, rec.Body.String())

	head := s.gitlab.Head("main")
	require.Equal(t, before, head.Parent)
	require.Equal(t, map[string]any{"sha": head.SHA, "path": intro, "message": head.Message}, body)
	require.Equal(t, "Add a paragraph (simulated upstream commit 1)", head.Message)
	require.Regexp(t, `First paragraph\.\n\nUpstream edit 1: .+\n$`, s.gitlab.Text("main")[intro])

	require.Len(t, s.hooks, 1)
	hook := s.hooks[0]
	require.Equal(t, "POST", hook.Method)
	require.Equal(t, "hook-secret", hook.Header.Get("X-Gitlab-Token"))
	require.Equal(t, "Push Hook", hook.Header.Get("X-Gitlab-Event"))
	require.Equal(t, "push", s.bodies[0]["object_kind"])
	require.Equal(t, "refs/heads/main", s.bodies[0]["ref"])
	require.Equal(t, before, s.bodies[0]["before"])
	require.Equal(t, head.SHA, s.bodies[0]["after"])
	require.Equal(t, map[string]any{"path_with_namespace": "demo/report"}, s.bodies[0]["project"])

	s.request(t, "POST", "/playground/upstream?room="+room)
	require.Equal(t, "Add a paragraph (simulated upstream commit 2)", s.gitlab.Head("main").Message, "numbered")
}

func TestUpstreamHeading(t *testing.T) {
	s := newSetup(t)
	s.request(t, "POST", "/playground/upstream?change=heading&room="+room)
	require.Regexp(t, `^= Introduction \(upstream revision 1\) <intro>\n`, s.gitlab.Text("main")[intro])
	require.Equal(t, "Revise a heading (simulated upstream commit 1)", s.gitlab.Head("main").Message)
}

func TestUpstreamOnAFreshBranchStartsAtMain(t *testing.T) {
	s := newSetup(t)
	rec, _ := s.request(t, "POST", "/playground/upstream?room="+url.QueryEscape("gitlab:demo/report@fresh"))
	require.Equal(t, 200, rec.Code)
	var paths []string
	for p := range s.gitlab.Text("fresh") {
		paths = append(paths, p)
	}
	slices.Sort(paths)
	require.Equal(t, []string{"/assets/logo.svg", intro, "/main.typ"}, paths)
	require.Equal(t, "refs/heads/fresh", s.bodies[0]["ref"])
}

func TestUpstreamReportsAFailingWebhook(t *testing.T) {
	gitlab := fakegitlab.New(playground.Project, files())
	webhook := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "wrong token", 403) })
	handler := playground.Handler(playground.Options{GitLab: gitlab, AppendTo: intro, Webhook: webhook}, http.NotFoundHandler())
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/playground/upstream?room="+room, nil))
	require.Equal(t, 502, rec.Code)
	require.Contains(t, rec.Body.String(), "403 wrong token")
}

func TestUpstreamWithoutWebhook(t *testing.T) {
	gitlab := fakegitlab.New(playground.Project, files())
	handler := playground.Handler(playground.Options{GitLab: gitlab, AppendTo: intro}, http.NotFoundHandler())
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/playground/upstream?room="+room, nil))
	require.Equal(t, 200, rec.Code)
}

func TestOutage(t *testing.T) {
	s := newSetup(t)
	_, body := s.request(t, "POST", "/playground/outage?room="+room)
	require.Equal(t, map[string]any{"branch": "main", "reachable": false}, body)
	push := strings.Repeat("0", 40) + " " + strings.Repeat("1", 40) + " refs/heads/main\x00report-status\n"
	get := func() error { // a git push to main (its first line suffices to tell the branch)
		req, _ := http.NewRequest("POST", fakegitlab.URL+"/demo/report.git/git-receive-pack", strings.NewReader(fmt.Sprintf("%04x", len(push)+4)+push+"0000"))
		req.Header.Set("Content-Type", "application/x-git-receive-pack-request")
		req.SetBasicAuth("oauth2", s.gitlab.TokenOf("Ann"))
		res, err := s.gitlab.Client().Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
		}
		return err
	}
	require.ErrorContains(t, get(), "connection reset")

	_, body = s.request(t, "POST", "/playground/outage?on=false&room="+room)
	require.Equal(t, map[string]any{"branch": "main", "reachable": true}, body)
	require.NoError(t, get())
}

func TestAutoCommit(t *testing.T) {
	s := newSetup(t)
	fresh := url.QueryEscape("gitlab:demo/report@fresh")
	rec, body := s.request(t, "POST", "/playground/auto-commit?room="+fresh)
	require.Equal(t, 200, rec.Code, rec.Body.String())
	require.Equal(t, map[string]any{"room": "gitlab:demo/report@fresh", "autoCommit": false}, body)
	_, body = s.request(t, "POST", "/playground/auto-commit?on=true&room="+fresh)
	require.Equal(t, map[string]any{"room": "gitlab:demo/report@fresh", "autoCommit": true}, body)
	require.Equal(t, []string{"gitlab:demo/report@fresh off=true", "gitlab:demo/report@fresh off=false"}, s.rooms.calls)

	handler := playground.Handler(playground.Options{GitLab: s.gitlab, AppendTo: intro}, http.NotFoundHandler())
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest("POST", "/playground/auto-commit?room="+room, nil))
	require.Equal(t, 404, rec.Code, "no GitLab rooms")
}

func TestRefusals(t *testing.T) {
	for _, tc := range []struct {
		method, target string
		status         int
	}{
		{"POST", "/playground/upstream?room=plain-room", 400},
		{"POST", "/playground/outage?room=plain-room", 400},
		{"POST", "/playground/upstream?room=" + url.QueryEscape("gitlab:demo/report@"), 400},
		{"GET", "/playground/outage?room=" + room, 405},
		{"POST", "/playground/auto-commit?room=plain-room", 400},
		{"POST", "/playground/auto-commit?room=" + url.QueryEscape("gitlab:other/project@main"), 404},
		{"GET", "/playground/auto-commit?room=" + room, 405},
		{"POST", "/playground/upstream?room=" + url.QueryEscape("gitlab:other/project@main"), 404},
		{"GET", "/playground/upstream?room=" + room, 405},
		{"POST", "/playground", 405},
	} {
		t.Run(tc.method+" "+tc.target, func(t *testing.T) {
			s := newSetup(t)
			rec, _ := s.request(t, tc.method, tc.target)
			require.Equal(t, tc.status, rec.Code)
			require.Equal(t, "*", rec.Header().Get("Access-Control-Allow-Origin"))
			require.Empty(t, s.hooks)
			require.Empty(t, s.rooms.calls)
		})
	}
}

func TestOtherRequestsGoToTheServerBehind(t *testing.T) {
	s := newSetup(t)
	s.request(t, "GET", "/")
	s.request(t, "GET", "/playground/other")
	require.Equal(t, 2, s.behind)
}

func TestUpstreamEdit(t *testing.T) {
	t.Run("append adds a numbered paragraph at the end", func(t *testing.T) {
		require.Regexp(t, `^= A\n\nText\.\n\nUpstream edit 2: .+\n$`, playground.UpstreamEdit("= A\n\nText.\n", playground.Append, 2))
		require.Regexp(t, `^Text\.\n\nUpstream edit 1: `, playground.UpstreamEdit("Text.", playground.Append, 1))
	})
	t.Run("heading revises the first heading, before its label", func(t *testing.T) {
		require.Equal(t, "Intro\n== Goals (upstream revision 3)\n= Later\n", playground.UpstreamEdit("Intro\n== Goals\n= Later\n", playground.Heading, 3))
		require.Equal(t, "= Intro (upstream revision 1) <intro>\n", playground.UpstreamEdit("= Intro <intro>\n", playground.Heading, 1))
	})
	t.Run("heading falls back to a paragraph when the file has no heading", func(t *testing.T) {
		require.Regexp(t, `Upstream edit 1: `, playground.UpstreamEdit("Text.\n", playground.Heading, 1))
	})
}

func TestReadProjectFiles(t *testing.T) {
	project, err := playground.ReadProjectFiles(filepath.Join(testutil.RepoRoot(t), "demo", "examples", "advanced"))
	require.NoError(t, err)
	require.Contains(t, string(project["/main.typ"]), `#include "chapters/introduction.typ"`)
	require.Contains(t, project, intro)
	require.Contains(t, string(project["/assets/logo.svg"]), "<svg")

	_, err = playground.ReadProjectFiles(filepath.Join(t.TempDir(), "missing"))
	require.Error(t, err)
}
