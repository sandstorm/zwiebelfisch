package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"typst-editor/server/lib/auth"
	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/fakegitlab"
	"typst-editor/server/lib/gitlab"
	"typst-editor/server/lib/playground"
	"typst-editor/server/lib/store"
)

// The server as the commands put it together, against the fake GitLab (rooms and sign-in), in-process.

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const host = "http://127.0.0.1:1234"

// newServer is the server for o, signing people in at fake.
func newServer(t *testing.T, fake *fakegitlab.GitLab, o Options) *Server {
	t.Helper()
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	o.Store, o.Log = st, zerolog.Nop()
	o.Auth = auth.New(auth.Options{
		Provider: gitlab.DefaultID, Issuer: fakegitlab.URL, ClientID: fakegitlab.ClientID, ClientSecret: fakegitlab.ClientSecret,
		Client: fake.Client(), Log: zerolog.Nop(),
	})
	s, err := New(o)
	require.NoError(t, err)
	t.Cleanup(func() {
		require.NoError(t, s.Close(context.Background()))
		require.NoError(t, st.Close())
	})
	return s
}

func fakeGitLab() (*fakegitlab.GitLab, *gitlab.Options) {
	fake := fakegitlab.New(playground.Project, fakegitlab.Files{"/main.typ": []byte("= Report\n"), "/logo.png": {1, 2, 3}})
	return fake, &gitlab.Options{URL: fakegitlab.URL, Token: fakegitlab.Token, Client: fake.Client(), WebhookSecret: "hook"}
}

// signIn signs name in through the server (the fake's page served next to it, as fake-gitlab does) and
// returns the session cookie.
func signIn(t *testing.T, fake *fakegitlab.GitLab, s *Server, name string) *http.Cookie {
	t.Helper()
	h := playground.Handler(playground.Options{GitLab: fake}, s)
	target, jar := host+"/auth/login?"+url.Values{"login_hint": {name}, "return": {"/"}}.Encode(), map[string]*http.Cookie{}
	for target != "" {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		for _, c := range jar {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		for _, c := range rec.Result().Cookies() {
			jar[c.Name] = c
		}
		require.Less(t, rec.Code, 400, rec.Body.String())
		next, _ := url.Parse(rec.Header().Get("Location"))
		target = ""
		if next.Path != "" && next.Path != "/" {
			target = host + next.RequestURI()
		}
	}
	require.Contains(t, jar, "typst_session")
	return jar["typst_session"]
}

func request(method, target string, session *http.Cookie) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	if session != nil {
		req.AddCookie(session)
	}
	return req
}

func get(t *testing.T, h http.Handler, req *http.Request) *http.Response {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

func text(t *testing.T, res *http.Response) string {
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return strings.TrimSpace(string(b))
}

func TestConfigurationErrors(t *testing.T) {
	_, err := New(Options{})
	require.ErrorContains(t, err, "no rooms to serve")
	_, err = New(Options{PlainRooms: true})
	require.ErrorContains(t, err, "no sign-in")
}

func TestWhoOpensWhichRoom(t *testing.T) {
	const room = "gitlab:demo/report@main"
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	fake.SetAccess("Rita", fakegitlab.Reporter)
	rita := signIn(t, fake, s, "Rita")
	fake.SetAccess("Stranger", fakegitlab.NoAccess)
	stranger := signIn(t, fake, s, "Stranger")
	reason := func(err error) string {
		var refusal collab.Refusal
		require.ErrorAs(t, err, &refusal, "a reason the widget shows")
		return refusal.Reason
	}

	user, err := s.authenticate(request("GET", host+"/", ann), room)
	require.NoError(t, err)
	require.Equal(t, collab.User{Provider: "gitlab", ID: "2", Name: "Ann", Email: "ann@gitlab.test"}, user)
	_, err = s.authenticate(request("GET", host+"/", nil), room)
	require.Equal(t, SignInRequired, reason(err))
	_, err = s.authenticate(request("GET", host+"/", rita), room)
	require.Equal(t, "Editing demo/report needs the Developer role on GitLab; you are Reporter.", reason(err))
	_, err = s.authenticate(request("GET", host+"/", stranger), room)
	require.Equal(t, "You are not a member of demo/report on GitLab.", reason(err))
	_, err = s.authenticate(request("GET", host+"/", ann), "playground-simple")
	require.Contains(t, reason(err), "only GitLab rooms")

	plainFake, _ := fakeGitLab()
	plain := newServer(t, plainFake, Options{PlainRooms: true})
	bob := signIn(t, plainFake, plain, "Bob")
	_, err = plain.authenticate(request("GET", host+"/", bob), "playground-simple")
	require.NoError(t, err, "plain rooms: anyone signed in")
	_, err = plain.authenticate(request("GET", host+"/", nil), "playground-simple")
	require.Equal(t, SignInRequired, reason(err))
	_, err = plain.authenticate(request("GET", host+"/", bob), room)
	require.NoError(t, err, "without GitLab rooms, a GitLab-like name is a plain room")
}

// A WebSocket without a session is refused before it gets anything, with the reason the widget acts on.
func TestConnectionWithoutSessionIsRefused(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl, PlainRooms: true})
	for _, room := range []string{"gitlab:demo/report@main", "plain"} {
		c := &conn{in: make(chan []byte, 2), out: make(chan []byte, 8), closed: make(chan struct{})}
		served := make(chan struct{})
		go func() { defer close(served); s.rooms.Serve(context.Background(), c, request("GET", host+"/", nil)) }()
		auth := append(append(varString(room), 2, 0), varString("a token is no session")...) // Auth, token
		sync := append(varString(room), 0, 0, 1, 0)                                          // SyncStep1, empty state vector
		c.in <- auth
		c.in <- sync
		reply := <-c.out
		require.Equal(t, append(append(varString(room), 2, 1), varString(SignInRequired)...), reply, "PermissionDenied: sign in")
		select {
		case msg := <-c.out:
			t.Fatalf("got %v after the refusal", msg)
		case <-time.After(50 * time.Millisecond): // anything the server would (wrongly) send comes by now
		}
		close(c.closed)
		<-served
	}
}

// conn is a Transport the test writes the client's messages into.
type conn struct {
	in, out chan []byte
	closed  chan struct{}
}

func (c *conn) Read(ctx context.Context) ([]byte, error) {
	select {
	case msg := <-c.in:
		return msg, nil
	case <-c.closed:
		return nil, errors.New("closed")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *conn) Write(_ context.Context, msg []byte) error {
	c.out <- msg
	return nil
}

func (c *conn) Close(int, string) {}

func varString(s string) []byte { return append([]byte{byte(len(s))}, s...) } // short strings only

func TestRoomFilesNeedASession(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	files := host + "/rooms/gitlab%3Ademo%2Freport%40main/files/logo.png"
	require.Equal(t, http.StatusUnauthorized, get(t, s, request("GET", files, nil)).StatusCode, "signed out")
	res := get(t, s, request("GET", files, ann))
	require.Equal(t, http.StatusNotFound, res.StatusCode, "signed in, the room not open")

	req := request("GET", files, ann)
	req.Header.Set("Origin", "http://127.0.0.1:5199")
	res = get(t, s, req)
	require.Equal(t, "http://127.0.0.1:5199", res.Header.Get("Access-Control-Allow-Origin"), "the demo, on another port, sends the cookie")
	require.Equal(t, "true", res.Header.Get("Access-Control-Allow-Credentials"))
}

func TestMe(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	require.Equal(t, http.StatusUnauthorized, get(t, s, request("GET", host+"/api/me", nil)).StatusCode)
	res := get(t, s, request("GET", host+"/api/me", signIn(t, fake, s, "Ann")))
	require.Equal(t, `{"provider":"gitlab","id":"2","name":"Ann","username":"ann","email":"ann@gitlab.test"}`, text(t, res))
}

func TestInfo(t *testing.T) {
	for _, plain := range []bool{false, true} {
		fake, gl := fakeGitLab()
		res := get(t, newServer(t, fake, Options{PlainRooms: plain, GitLab: gl}), request("GET", "/api/info", nil))
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, "*", res.Header.Get("Access-Control-Allow-Origin"), "the demo asks from another port")
		require.Equal(t, map[bool]string{false: `{"plainRooms":false}`, true: `{"plainRooms":true}`}[plain], text(t, res))
	}
}

func TestRoutes(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	require.Equal(t, "Typst editor collaboration server", text(t, get(t, s, request("GET", "/", nil))), "anything else: the WebSocket's probe answer")
	require.Equal(t, 401, get(t, s, request("POST", "/gitlab/webhook", nil)).StatusCode, "the webhook, without its secret")
	require.Equal(t, 302, get(t, s, request("GET", "/auth/login", nil)).StatusCode, "the sign-in")

	noHookFake, noHook := fakeGitLab()
	noHook.WebhookSecret = ""
	require.NotEqual(t, 401, get(t, newServer(t, noHookFake, Options{GitLab: noHook}), request("POST", "/gitlab/webhook", nil)).StatusCode, "no webhook without a secret")
}

// The playground's simulated push reaches the GitLab rooms' webhook through the server (as fake-gitlab wires it).
func TestPlaygroundPushReachesTheWebhook(t *testing.T) {
	fake, gl := fakeGitLab()
	fake.SetAutoBranches(true)
	s := newServer(t, fake, Options{GitLab: gl})
	h := playground.Handler(playground.Options{GitLab: fake, AppendTo: "/main.typ", Webhook: s, WebhookSecret: gl.WebhookSecret}, s)
	res := get(t, h, request("POST", "/playground/upstream?room=gitlab%3Ademo%2Freport%40main", nil))
	require.Equal(t, 200, res.StatusCode, text(t, res))

	gl.WebhookSecret = "other"
	s = newServer(t, fake, Options{GitLab: gl})
	h = playground.Handler(playground.Options{GitLab: fake, AppendTo: "/main.typ", Webhook: s, WebhookSecret: "hook"}, s)
	require.Equal(t, 502, get(t, h, request("POST", "/playground/upstream?room=gitlab%3Ademo%2Freport%40main", nil)).StatusCode, "a refused webhook is reported")
}

// fake-gitlab hands the server's GitLab rooms to the playground's auto-commit switch.
func TestPlaygroundAutoCommitReachesTheRooms(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	require.NotNil(t, s.GitLab())
	h := playground.Handler(playground.Options{GitLab: fake, AppendTo: "/main.typ", Rooms: s.GitLab()}, s)
	res := get(t, h, request("POST", "/playground/auto-commit?room=gitlab%3Ademo%2Freport%40main", nil))
	require.Equal(t, 200, res.StatusCode)
	require.Equal(t, `{"autoCommit":false,"room":"gitlab:demo/report@main"}`, text(t, res))

	plainFake, _ := fakeGitLab()
	require.Nil(t, newServer(t, plainFake, Options{PlainRooms: true}).GitLab(), "no GitLab rooms")
}
