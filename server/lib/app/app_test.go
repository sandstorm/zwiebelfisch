package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/fakegitlab"
	"typst-editor/server/lib/gitlab"
	"typst-editor/server/lib/playground"
	"typst-editor/server/lib/store"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

func newServer(t *testing.T, o Options) *Server {
	t.Helper()
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	o.Store, o.Authenticate, o.Log = st, collab.SharedToken(nil), zerolog.Nop()
	s, err := New(o)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, s.Close(context.Background()))
		require.NoError(t, st.Close())
	})
	return s
}

func fakeGitLab() (*fakegitlab.GitLab, *gitlab.Options) {
	fake := fakegitlab.New(playground.Project, fakegitlab.Files{"/main.typ": []byte("= Report\n")})
	return fake, &gitlab.Options{URL: fakegitlab.URL, Token: fakegitlab.Token, Client: fake.Client(), WebhookSecret: "hook"}
}

func get(t *testing.T, h http.Handler, method, target string) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec.Result()
}

func text(t *testing.T, res *http.Response) string {
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return strings.TrimSpace(string(b))
}

func TestNoRoomsIsAnError(t *testing.T) {
	_, err := New(Options{Authenticate: collab.SharedToken(nil)})
	require.ErrorContains(t, err, "no rooms to serve")
}

func TestPlainRoomsOnlyWhenEnabled(t *testing.T) {
	_, gl := fakeGitLab()
	gitlabOnly := newServer(t, Options{GitLab: gl})
	_, err := gitlabOnly.authenticate("", "gitlab:demo/report@main")
	require.NoError(t, err)
	_, err = gitlabOnly.authenticate("", "playground-simple")
	var refusal collab.Refusal
	require.ErrorAs(t, err, &refusal, "a reason the widget shows")
	require.Contains(t, refusal.Reason, "only GitLab rooms")

	plain := newServer(t, Options{PlainRooms: true})
	_, err = plain.authenticate("", "playground-simple")
	require.NoError(t, err)
	_, err = plain.authenticate("", "gitlab:demo/report@main")
	require.NoError(t, err, "without GitLab rooms, a GitLab-like name is a plain room")
}

func TestTokenIsStillChecked(t *testing.T) {
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	secret := "secret"
	s, err := New(Options{Store: st, Authenticate: collab.SharedToken(&secret), PlainRooms: true, Log: zerolog.Nop()})
	require.NoError(t, err)
	defer s.Close(context.Background())
	_, err = s.authenticate("wrong", "room")
	require.ErrorIs(t, err, collab.ErrInvalidToken)
}

func TestInfo(t *testing.T) {
	for _, plain := range []bool{false, true} {
		_, gl := fakeGitLab()
		res := get(t, newServer(t, Options{PlainRooms: plain, GitLab: gl}), "GET", "/api/info")
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, "*", res.Header.Get("Access-Control-Allow-Origin"), "the demo asks from another port")
		require.Equal(t, map[bool]string{false: `{"plainRooms":false}`, true: `{"plainRooms":true}`}[plain], text(t, res))
	}
}

func TestRoutes(t *testing.T) {
	_, gl := fakeGitLab()
	s := newServer(t, Options{GitLab: gl})
	require.Equal(t, "Typst editor collaboration server", text(t, get(t, s, "GET", "/")), "anything else: the WebSocket's probe answer")
	files := get(t, s, "GET", "/rooms/gitlab%3Ademo%2Freport%40main/files/a.png")
	require.Equal(t, 404, files.StatusCode, "a room that is not open")
	require.Equal(t, "*", files.Header.Get("Access-Control-Allow-Origin"), "answered by the GitLab rooms")
	require.Equal(t, 401, get(t, s, "POST", "/gitlab/webhook").StatusCode, "the webhook, without its secret")

	_, noHook := fakeGitLab()
	noHook.WebhookSecret = ""
	require.NotEqual(t, 401, get(t, newServer(t, Options{GitLab: noHook}), "POST", "/gitlab/webhook").StatusCode, "no webhook without a secret")
}

// The playground's simulated push reaches the GitLab rooms' webhook through the server (as fake-gitlab wires it).
func TestPlaygroundPushReachesTheWebhook(t *testing.T) {
	fake, gl := fakeGitLab()
	fake.SetAutoBranches(true)
	s := newServer(t, Options{GitLab: gl})
	h := playground.Handler(playground.Options{GitLab: fake, AppendTo: "/main.typ", Webhook: s, WebhookSecret: gl.WebhookSecret}, s)
	res := get(t, h, "POST", "/playground/upstream?room=gitlab%3Ademo%2Freport%40main")
	require.Equal(t, 200, res.StatusCode, text(t, res))

	gl.WebhookSecret = "other"
	s = newServer(t, Options{GitLab: gl})
	h = playground.Handler(playground.Options{GitLab: fake, AppendTo: "/main.typ", Webhook: s, WebhookSecret: "hook"}, s)
	require.Equal(t, 502, get(t, h, "POST", "/playground/upstream?room=gitlab%3Ademo%2Freport%40main").StatusCode, "a refused webhook is reported")
}
