package app

import (
	"context"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/gitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/playground"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

// The server as the commands put it together, against the fake GitLab (rooms and sign-in), in-process.

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const host = "http://127.0.0.1:1234"

// testServer is a Server and its sign-in.
type testServer struct {
	*Server
	auth *auth.Auth
}

// newServer is the server for o, signing people in at fake.
func newServer(t *testing.T, fake *fakegitlab.GitLab, o Options) *testServer {
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
	return &testServer{s, o.Auth}
}

// identified is req as requireSignIn passes it on (with no session: as it is).
func (s *testServer) identified(req *http.Request) *http.Request {
	if identity, ok := s.auth.Identify(req); ok {
		return auth.WithIdentity(req, identity)
	}
	return req
}

func fakeGitLab() (*fakegitlab.GitLab, *gitlab.Options) {
	fake := fakegitlab.New(playground.Project, fakegitlab.Files{"/main.typ": []byte("= Report\n"), "/logo.png": {1, 2, 3}})
	return fake, &gitlab.Options{URL: fakegitlab.URL, Client: fake.Client(), WebhookSecret: "hook"}
}

// signIn signs name in through the server (the fake's page served next to it, as fake-gitlab does) and
// returns the session cookie.
func signIn(t *testing.T, fake *fakegitlab.GitLab, s *testServer, name string) *http.Cookie {
	t.Helper()
	h := playground.Handler(playground.Options{GitLab: fake}, s)
	target, jar := host+"/api/public/auth/login?"+url.Values{"login_hint": {name}, "return": {"/"}}.Encode(), map[string]*http.Cookie{}
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
	require.Contains(t, jar, "zwf_session")
	return jar["zwf_session"]
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

	user, err := s.authenticate(s.identified(request("GET", host+"/api/collaboration", ann)), room)
	require.NoError(t, err)
	require.Equal(t, collab.User{Provider: "gitlab", ID: "2", Name: "Ann", Email: "ann@gitlab.test"}, user)
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", nil)), room)
	require.Error(t, err, "not behind requireSignIn")
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", rita)), room)
	require.Equal(t, "Editing demo/report needs the Developer role on GitLab; you are Reporter.", reason(err))
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", stranger)), room)
	require.Equal(t, "You are not a member of demo/report on GitLab.", reason(err))
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", ann)), "playground-simple")
	require.Contains(t, reason(err), "only GitLab rooms")

	plainFake, _ := fakeGitLab()
	plain := newServer(t, plainFake, Options{PlainRooms: true})
	bob := signIn(t, plainFake, plain, "Bob")
	_, err = plain.authenticate(plain.identified(request("GET", host+"/api/collaboration", bob)), "playground-simple")
	require.NoError(t, err, "plain rooms: anyone signed in")
	for _, name := range []string{room, "gitlab:", "other:room"} {
		_, err = plain.authenticate(plain.identified(request("GET", host+"/api/collaboration", bob)), name)
		require.Equal(t, fmt.Sprintf("Room names with a colon are not plain rooms, and this server opens no %q.", name), reason(err),
			"a colon names a room provider: never a plain room, so the store keeps them apart")
	}
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", ann)), "gitlab:no-branch")
	require.Contains(t, reason(err), "only GitLab rooms", "not a GitLab room name, and no plain rooms here")
}

// GitLab rooms ask GitLab with the signed-in user's own token, refreshed when it expired.
func TestGitLabIsAskedWithTheUsersToken(t *testing.T) {
	fake, gl := fakeGitLab()
	fake.IdentityProvider().SetTokenLifetime(time.Second) // expired at once: every use refreshes it
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	first, err := s.auth.Token(context.Background(), "2")
	require.NoError(t, err)
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", ann)), "gitlab:demo/report@main")
	require.NoError(t, err, "asked with a refreshed token")
	second, err := s.auth.Token(context.Background(), "2")
	require.NoError(t, err)
	require.NotEqual(t, first, second, "rotated")
	require.Contains(t, fake.Requests(), "GET /members/all/2")
	require.Contains(t, fake.Requests(), "GET /repository/branches/main")

	_, err = s.auth.Token(context.Background(), "3")
	require.ErrorIs(t, err, auth.ErrNoToken, "nobody signed in as 3")
	require.Equal(t, http.StatusNoContent, get(t, s, request("POST", host+"/api/auth/logout", ann)).StatusCode)
	_, err = s.auth.Token(context.Background(), "2")
	require.ErrorIs(t, err, auth.ErrNoToken, "signed out: the token is gone")
}

func TestHTTPServerBoundsSlowAndIdleClients(t *testing.T) {
	s := newHTTPServer(http.NotFoundHandler())
	require.Positive(t, s.ReadHeaderTimeout)
	require.Positive(t, s.ReadTimeout, "a WebSocket is hijacked: its read deadline is cleared")
	require.Positive(t, s.IdleTimeout)
	require.Positive(t, s.MaxHeaderBytes)
}

func TestRoomFilesNeedASession(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	files := host + "/api/rooms/gitlab%3Ademo%2Freport%40main/files/logo.png"
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
		res := get(t, newServer(t, fake, Options{PlainRooms: plain, GitLab: gl}), request("GET", "/api/public/info", nil))
		require.Equal(t, 200, res.StatusCode)
		require.Equal(t, "*", res.Header.Get("Access-Control-Allow-Origin"), "the demo asks from another port")
		require.Equal(t, map[bool]string{false: `{"plainRooms":false}`, true: `{"plainRooms":true}`}[plain], text(t, res))
	}
}

// The rule: every route outside /api/public/ answers 401 to a client without a session (a WebSocket before
// its upgrade, unknown paths too), with the CORS that lets the widget read it; the public routes work
// without one.
func TestOnlyPublicRoutesAnswerWithoutASession(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl, PlainRooms: true})
	require.ElementsMatch(t, []string{
		"GET /api/collaboration", "GET /api/me", "POST /api/auth/logout", "GET /api/rooms/{room}/files/{path...}",
	}, s.signedIn.patterns)
	for _, pattern := range append(s.signedIn.patterns, "GET /", "GET /unknown", "GET /api/unknown") {
		req := requestFor(pattern)
		req.Header.Set("Origin", "http://127.0.0.1:5199")
		res := get(t, s, req)
		require.Equal(t, http.StatusUnauthorized, res.StatusCode, pattern)
		require.Equal(t, "http://127.0.0.1:5199", res.Header.Get("Access-Control-Allow-Origin"), "the widget reads the 401")
		require.Equal(t, "true", res.Header.Get("Access-Control-Allow-Credentials"))
	}
	upgrade := requestFor("GET /api/collaboration")
	upgrade.Header.Set("Connection", "Upgrade")
	upgrade.Header.Set("Upgrade", "websocket")
	upgrade.Header.Set("Sec-WebSocket-Version", "13")
	upgrade.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
	require.Equal(t, http.StatusUnauthorized, get(t, s, upgrade).StatusCode, "the WebSocket: refused before the upgrade")

	public := map[string]struct {
		status int
		why    string
	}{
		"GET /api/public/auth/login":      {http.StatusFound, "to the identity provider"},
		"GET " + auth.CallbackPath:        {http.StatusBadRequest, "no sign-in began: its own answer"},
		"GET /api/public/info":            {http.StatusOK, "what the server offers"},
		"POST /api/public/gitlab/webhook": {http.StatusAccepted, "GitLab, with its token"},
	}
	require.ElementsMatch(t, slices.Collect(maps.Keys(public)), s.public.patterns)
	for pattern, want := range public {
		req := requestFor(pattern)
		req.Header.Set("X-Gitlab-Token", "hook")
		require.Equal(t, want.status, get(t, s, req).StatusCode, "%s: %s", pattern, want.why)
	}
	require.Equal(t, http.StatusUnauthorized, get(t, s, requestFor("POST /api/public/gitlab/webhook")).StatusCode, "the webhook, without its secret")
	require.Equal(t, http.StatusNotFound, get(t, s, requestFor("GET /api/public/unknown")).StatusCode)

	noHookFake, noHook := fakeGitLab()
	noHook.WebhookSecret = ""
	require.Equal(t, http.StatusNotFound, get(t, newServer(t, noHookFake, Options{GitLab: noHook}), requestFor("POST /api/public/gitlab/webhook")).StatusCode, "no webhook without a secret")
}

// Signed in, the routes answer; unknown paths are 404.
func TestSignedInRoutesAnswer(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	require.Equal(t, http.StatusOK, get(t, s, request("GET", host+"/api/me", ann)).StatusCode)
	require.Equal(t, http.StatusNotFound, get(t, s, request("GET", host+"/unknown", ann)).StatusCode)
	require.Equal(t, http.StatusNoContent, get(t, s, request("POST", host+"/api/auth/logout", ann)).StatusCode)
	require.Equal(t, http.StatusUnauthorized, get(t, s, request("GET", host+"/api/me", ann)).StatusCode, "signed out")
}

// A public route outside /api/public/ cannot be registered.
func TestPublicRoutesLiveUnderTheirPrefix(t *testing.T) {
	require.Panics(t, func() { newRoutes(PublicPrefix).HandleFunc("GET /api/info", http.NotFound) })
	require.Panics(t, func() { newRoutes(PublicPrefix).HandleFunc("/", http.NotFound) })
	require.NotPanics(t, func() { newRoutes(PublicPrefix).HandleFunc("GET /api/public/x", http.NotFound) })
}

// requestFor is a request matching pattern ("METHOD /path", wildcards filled in), with a JSON body.
func requestFor(pattern string) *http.Request {
	method, path, _ := strings.Cut(pattern, " ")
	path = strings.NewReplacer("{room}", url.PathEscape("gitlab:demo/report@main"), "{path...}", "logo.png").Replace(path)
	return httptest.NewRequest(method, host+path, strings.NewReader("{}"))
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
