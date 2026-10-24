package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

// The whole sign-in against the fake GitLab's OpenID Connect provider, in-process: requests are handler
// calls (the sandbox the tests run in cannot bind ports), the browser is a cookie jar following redirects.

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const server = "http://127.0.0.1:1234"

type browser struct {
	t       *testing.T
	auth    *Auth
	server  http.Handler // the handlers as package app mounts them
	fake    *fakegitlab.GitLab
	cookies map[string]*http.Cookie
	origin  string // the page's (sent as Origin), "" for navigations
}

func newBrowser(t *testing.T, o Options) *browser {
	fake := fakegitlab.New("demo/report", fakegitlab.Files{"/main.typ": []byte("x")})
	o.Provider, o.Issuer, o.ClientID, o.ClientSecret = "gitlab", fakegitlab.URL, fakegitlab.ClientID, fakegitlab.ClientSecret
	o.Client, o.Log = fake.Client(), zerolog.Nop()
	a := New(o)
	return &browser{t: t, auth: a, server: mount(a), fake: fake, cookies: map[string]*http.Cookie{}}
}

// mount is the handlers as package app mounts them: Logout and Me behind its sign-in check.
func mount(a *Auth) http.Handler {
	signedIn := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			identity, ok := a.Identify(r)
			if !ok {
				http.Error(w, "Not signed in", http.StatusUnauthorized)
				return
			}
			next(w, WithIdentity(r, identity))
		}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/public/auth/login", a.Login)
	mux.HandleFunc("GET "+CallbackPath, a.Callback)
	mux.HandleFunc("POST /api/auth/logout", signedIn(a.Logout))
	mux.HandleFunc("GET /api/me", signedIn(a.Me))
	return mux
}

// do sends one request to the server (or the fake's sign-in page) with the browser's cookies.
func (b *browser) do(method, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	for _, c := range b.cookies {
		if strings.HasPrefix(req.URL.Path, c.Path) {
			req.AddCookie(c)
		}
	}
	if b.origin != "" {
		req.Header.Set("Origin", b.origin)
	}
	res := httptest.NewRecorder()
	if req.URL.Path == "/oauth/authorize" { // the fake's page, on whatever host sent the browser there
		b.fake.IdentityProvider().ServeHTTP(res, req)
	} else {
		b.server.ServeHTTP(res, req)
	}
	for _, c := range res.Result().Cookies() {
		if c.MaxAge < 0 {
			delete(b.cookies, c.Name)
		} else {
			b.cookies[c.Name] = c
		}
	}
	return res
}

// follow requests target and follows redirects within the server; returns the last answer.
func (b *browser) follow(target string) *httptest.ResponseRecorder {
	for range 10 {
		res := b.do(http.MethodGet, target)
		if res.Code != http.StatusFound && res.Code != http.StatusSeeOther {
			return res
		}
		next, err := url.Parse(res.Header().Get("Location"))
		require.NoError(b.t, err)
		if next.Host != "" && next.Host != "127.0.0.1:1234" {
			return res // left the server (the return URL)
		}
		target = server + next.RequestURI()
	}
	b.t.Fatal("redirect loop")
	return nil
}

func (b *browser) signIn(name, back string) *httptest.ResponseRecorder {
	return b.follow(server + "/api/public/auth/login?" + url.Values{"return": {back}, "login_hint": {name}}.Encode())
}

func (b *browser) me() (Identity, int) {
	res := b.do(http.MethodGet, server+"/api/me")
	var identity Identity
	if res.Code == http.StatusOK {
		require.NoError(b.t, json.Unmarshal(res.Body.Bytes(), &identity))
	}
	return identity, res.Code
}

func TestSignIn(t *testing.T) {
	b := newBrowser(t, Options{})
	_, status := b.me()
	require.Equal(t, http.StatusUnauthorized, status)

	res := b.signIn("Ann Lee", "http://127.0.0.1:5199/?room=gitlab%3Ademo%2Freport%40main")
	require.Equal(t, http.StatusSeeOther, res.Code)
	require.Equal(t, "http://127.0.0.1:5199/?room=gitlab%3Ademo%2Freport%40main", res.Header().Get("Location"), "back where it began (another loopback port)")
	identity, status := b.me()
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, Identity{Provider: "gitlab", Subject: "2", Name: "Ann Lee", Username: "ann.lee", Email: "ann.lee@gitlab.test"}, identity)

	session := b.cookies[sessionCookie]
	require.NotNil(t, session)
	require.True(t, session.HttpOnly)
	require.Equal(t, http.SameSiteLaxMode, session.SameSite)
	require.False(t, session.Secure, "http on a loopback host")
	require.Equal(t, "/", session.Path)
	require.NotContains(t, b.cookies, loginCookie, "the sign-in's cookie is gone")

	req := httptest.NewRequest(http.MethodGet, server+"/", nil)
	req.AddCookie(session)
	got, ok := b.auth.Identify(req)
	require.True(t, ok)
	require.Equal(t, identity, got)
}

func TestTheFakesPageAsksForANameWithoutAHint(t *testing.T) {
	b := newBrowser(t, Options{})
	res := b.do(http.MethodGet, server+"/api/public/auth/login?return=/")
	require.Equal(t, http.StatusFound, res.Code)
	page := b.do(http.MethodGet, server+res.Header().Get("Location"))
	require.Equal(t, http.StatusOK, page.Code)
	require.Contains(t, page.Body.String(), `<input name="user"`)
	require.Contains(t, page.Body.String(), `name="state"`, "the request's parameters stay in the form")
}

func TestSecureCookiesOffLoopback(t *testing.T) {
	b := newBrowser(t, Options{})
	res := b.do(http.MethodGet, "https://editor.example.org/api/public/auth/login?return=/")
	require.Equal(t, http.StatusFound, res.Code)
	require.True(t, b.cookies[loginCookie].Secure)
	require.Contains(t, res.Header().Get("Location"), url.QueryEscape("https://editor.example.org/api/public/auth/callback"), "the callback on the host the browser named")
}

func TestRedirectURLFromConfig(t *testing.T) {
	b := newBrowser(t, Options{RedirectURL: "https://editor.example.org/api/public/auth/callback"})
	res := b.do(http.MethodGet, server+"/api/public/auth/login")
	require.Contains(t, res.Header().Get("Location"), "redirect_uri="+url.QueryEscape("https://editor.example.org/api/public/auth/callback"))
	require.Contains(t, res.Header().Get("Location"), "code_challenge_method=S256")
	require.Contains(t, res.Header().Get("Location"), "nonce=")
}

func TestCallbackRefusals(t *testing.T) {
	t.Run("a callback this browser did not begin (no or another login cookie)", func(t *testing.T) {
		victim, attacker := newBrowser(t, Options{}), newBrowser(t, Options{})
		attacker.auth = victim.auth // the same server
		attacker.fake = victim.fake
		res := attacker.do(http.MethodGet, server+"/api/public/auth/login?login_hint=Mallory")
		callback := attacker.do(http.MethodGet, server+res.Header().Get("Location")).Header().Get("Location")
		res = victim.do(http.MethodGet, callback)
		require.Equal(t, http.StatusBadRequest, res.Code)
		_, status := victim.me()
		require.Equal(t, http.StatusUnauthorized, status, "not signed in as Mallory")
	})

	t.Run("a callback used twice: the provider takes a code once", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/api/public/auth/login?login_hint=Ann")
		callback := b.do(http.MethodGet, server+res.Header().Get("Location")).Header().Get("Location")
		login := b.cookies[loginCookie]
		require.Equal(t, http.StatusSeeOther, b.do(http.MethodGet, callback).Code)
		b.cookies[loginCookie] = login
		require.Equal(t, http.StatusBadGateway, b.do(http.MethodGet, callback).Code)
		require.Len(t, b.auth.sessions, 1, "no second session")
	})

	t.Run("a login cookie forged, from another server, or expired", func(t *testing.T) {
		now := time.Now()
		b := newBrowser(t, Options{now: func() time.Time { return now }})
		res := b.do(http.MethodGet, server+"/api/public/auth/login?login_hint=Ann")
		callback := b.do(http.MethodGet, server+res.Header().Get("Location")).Header().Get("Location")
		login := *b.cookies[loginCookie]
		forged := login
		forged.Value = login.Value[:len(login.Value)-2] + "AA"
		b.cookies[loginCookie] = &forged
		require.Equal(t, http.StatusBadRequest, b.do(http.MethodGet, callback).Code)

		restarted := newBrowser(t, Options{}) // its key is another
		restarted.cookies[loginCookie] = &login
		require.Equal(t, http.StatusBadRequest, restarted.do(http.MethodGet, callback).Code)

		now = now.Add(loginLifetime + time.Second)
		b.cookies[loginCookie] = &login
		require.Equal(t, http.StatusBadRequest, b.do(http.MethodGet, callback).Code)
	})

	t.Run("the provider refused", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/api/public/auth/login")
		state := mustQuery(t, res.Header().Get("Location")).Get("state")
		res = b.do(http.MethodGet, server+"/api/public/auth/callback?"+url.Values{"state": {state}, "error": {"access_denied"}, "error_description": {"The user denied it"}}.Encode())
		require.Equal(t, http.StatusForbidden, res.Code)
		require.Contains(t, res.Body.String(), "The user denied it")
	})

	t.Run("a code the provider does not know", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/api/public/auth/login")
		state := mustQuery(t, res.Header().Get("Location")).Get("state")
		res = b.do(http.MethodGet, server+"/api/public/auth/callback?"+url.Values{"state": {state}, "code": {"forged"}}.Encode())
		require.Equal(t, http.StatusBadGateway, res.Code)
		_, status := b.me()
		require.Equal(t, http.StatusUnauthorized, status)
	})
}

func mustQuery(t *testing.T, target string) url.Values {
	u, err := url.Parse(target)
	require.NoError(t, err)
	return u.Query()
}

func TestReturnURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://editor.example.org/api/public/auth/login", nil)
	for raw, want := range map[string]string{
		"":                                    "/",
		"/projects?x=1#a":                     "/projects?x=1#a",
		"http://editor.example.org:5199/?a=b": "/",
		"https://editor.example.org/x":        "https://editor.example.org/x",
		"https://evil.example/":               "/",
		"//evil.example/":                     "/",
		"/\\evil.example":                     "/",
		"javascript:alert(1)":                 "/",
		"https://user@editor.example.org/":    "/",
	} {
		require.Equal(t, want, returnURL(req, raw), raw)
	}
	loopback := httptest.NewRequest(http.MethodGet, server+"/api/public/auth/login", nil)
	require.Equal(t, "http://localhost:5199/x", returnURL(loopback, "http://localhost:5199/x"), "the demo, on another loopback port")
}

func TestAllowedOrigin(t *testing.T) {
	for _, c := range []struct {
		host, origin string
		allowed      bool
	}{
		{"editor.example.org", "", true},                           // a navigation, or not a browser
		{"editor.example.org", "https://editor.example.org", true}, // same origin
		{"editor.example.org", "http://editor.example.org", true},  // behind a TLS-terminating proxy
		{"editor.example.org:443", "https://editor.example.org", true},
		{"editor.example.org", "https://editor.example.org:443", true},
		{"Editor.Example.org", "https://editor.example.org", true},
		{"editor.example.org:8443", "https://editor.example.org:8443", true},
		{"editor.example.org", "https://editor.example.org:5199", false}, // same host, another port
		{"editor.example.org:1234", "https://editor.example.org", false},
		{"editor.example.org", "https://evil.example", false},
		{"editor.example.org", "https://editor.example.org.evil.example", false},
		{"editor.example.org", "null", false}, // an opaque origin (a sandboxed frame, a file)
		{"editor.example.org", "://x", false}, // malformed
		{"editor.example.org", "https://user@editor.example.org", false},
		{"127.0.0.1:1234", "http://127.0.0.1:5199", true}, // the demo against the server
		{"127.0.0.1:1234", "http://localhost:5199", true}, // both loopback
		{"localhost:1234", "http://[::1]:5199", true},
		{"[::1]:1234", "http://[::1]:5199", true},
		{"127.0.0.1:1234", "http://evil.example", false},
		{"editor.example.org", "http://localhost:5199", false}, // a loopback page, a public server
		{"[2001:db8::1]:8443", "https://[2001:db8::1]:8443", true},
		{"[2001:db8::1]:8443", "https://[2001:db8::1]:9443", false},
	} {
		req := httptest.NewRequest(http.MethodGet, "http://"+c.host+"/api/me", nil)
		if c.origin != "" {
			req.Header.Set("Origin", c.origin)
		}
		require.Equal(t, c.allowed, AllowedOrigin(req), "%s from %q", c.host, c.origin)
	}
}

func TestLogout(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	session := b.cookies[sessionCookie]
	require.Equal(t, http.StatusNoContent, b.do(http.MethodPost, server+"/api/auth/logout").Code)
	require.NotContains(t, b.cookies, sessionCookie)
	b.cookies[sessionCookie] = session // a copy kept elsewhere is worth nothing now
	_, status := b.me()
	require.Equal(t, http.StatusUnauthorized, status)
}

func TestOtherSitesPagesAreNobody(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	b.origin = "http://127.0.0.1:5199" // the demo: another loopback port
	_, status := b.me()
	require.Equal(t, http.StatusOK, status)

	b.origin = "https://evil.example"
	_, status = b.me()
	require.Equal(t, http.StatusUnauthorized, status)
	require.Equal(t, http.StatusUnauthorized, b.do(http.MethodPost, server+"/api/auth/logout").Code)
	b.origin = ""
	_, status = b.me()
	require.Equal(t, http.StatusOK, status, "another site cannot sign the user out either")
}

func TestSessionsExpire(t *testing.T) {
	now := time.Now()
	b := newBrowser(t, Options{now: func() time.Time { return now }})
	b.signIn("Ann", "/")
	now = now.Add(SessionLifetime - time.Minute)
	_, status := b.me()
	require.Equal(t, http.StatusOK, status)
	now = now.Add(2 * time.Minute)
	_, status = b.me()
	require.Equal(t, http.StatusUnauthorized, status)
}

func TestProviderUnreachable(t *testing.T) {
	a := New(Options{Provider: "gitlab", Issuer: "https://gitlab.invalid", ClientID: "x", ClientSecret: "y", Client: fakegitlab.New("p", nil).Client(), Log: zerolog.Nop()})
	res := httptest.NewRecorder()
	mount(a).ServeHTTP(res, httptest.NewRequest(http.MethodGet, server+"/api/public/auth/login", nil))
	require.Equal(t, http.StatusBadGateway, res.Code)
	require.Contains(t, res.Body.String(), "cannot be reached")
}

func TestTokenOfASignedInUser(t *testing.T) {
	ctx := context.Background()
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	_, err := b.auth.Token(ctx, "3")
	require.ErrorIs(t, err, ErrNoToken, "nobody signed in as 3")
	token, err := b.auth.Token(ctx, "2")
	require.NoError(t, err)
	again, err := b.auth.Token(ctx, "2")
	require.NoError(t, err)
	require.Equal(t, token, again, "still valid: no refresh")

	t.Run("an expired token is refreshed once at a time, and the rotated refresh token kept", func(t *testing.T) {
		b := newBrowser(t, Options{})
		b.fake.IdentityProvider().SetTokenLifetime(time.Second) // expired at once (oauth2 renews 10 s early)
		b.signIn("Ann", "/")
		var wg sync.WaitGroup
		tokens := make([]string, 8)
		for i := range tokens {
			wg.Go(func() {
				var err error
				tokens[i], err = b.auth.Token(ctx, "2")
				require.NoError(t, err)
			})
		}
		wg.Wait()
		second, err := b.auth.Token(ctx, "2") // a third refresh: works only with the rotated refresh token
		require.NoError(t, err)
		require.NotContains(t, tokens, second)
	})

	t.Run("a refresh for a request that ended still finishes and keeps the rotated refresh token", func(t *testing.T) {
		b := newBrowser(t, Options{})
		b.fake.IdentityProvider().SetTokenLifetime(time.Second)
		b.signIn("Ann", "/")
		b.auth.opts.Client = &http.Client{Transport: endsWithRequest{b.fake.Client().Transport}}
		ended, cancel := context.WithCancel(ctx)
		cancel()
		first, err := b.auth.Token(ended, "2")
		require.NoError(t, err)
		second, err := b.auth.Token(ctx, "2") // works only with the refresh token the first refresh got
		require.NoError(t, err)
		require.NotEqual(t, first, second)
	})

	t.Run("from any live session; none after signing out of all", func(t *testing.T) {
		b := newBrowser(t, Options{})
		b.signIn("Ann", "/")
		other := &browser{t: t, auth: b.auth, server: b.server, fake: b.fake, cookies: map[string]*http.Cookie{}}
		other.signIn("Ann", "/")
		require.Equal(t, http.StatusNoContent, b.do(http.MethodPost, server+"/api/auth/logout").Code)
		_, err := b.auth.Token(ctx, "2")
		require.NoError(t, err, "the other browser's session")
		require.Equal(t, http.StatusNoContent, other.do(http.MethodPost, server+"/api/auth/logout").Code)
		_, err = b.auth.Token(ctx, "2")
		require.ErrorIs(t, err, ErrNoToken)
	})

	t.Run("not from an expired session", func(t *testing.T) {
		now := time.Now()
		b := newBrowser(t, Options{now: func() time.Time { return now }})
		b.signIn("Ann", "/")
		now = now.Add(SessionLifetime + time.Minute)
		_, err := b.auth.Token(ctx, "2")
		require.ErrorIs(t, err, ErrNoToken)
	})
}

// endsWithRequest fails a request whose context ended, as a real connection does.
type endsWithRequest struct{ next http.RoundTripper }

func (t endsWithRequest) RoundTrip(r *http.Request) (*http.Response, error) {
	if err := r.Context().Err(); err != nil {
		return nil, err
	}
	return t.next.RoundTrip(r)
}

func TestStartSessionWithoutTokenUntilItsEnd(t *testing.T) {
	now := time.Now()
	b := newBrowser(t, Options{now: func() time.Time { return now }})
	guest := Identity{Provider: "guest", Subject: "share/1", Name: "Jane (guest)"}
	res := httptest.NewRecorder()
	b.auth.StartSession(res, httptest.NewRequest(http.MethodPost, server+"/api/public/guest/join", nil), guest, now.Add(time.Hour))
	cookie := res.Result().Cookies()[0]
	require.Equal(t, sessionCookie, cookie.Name)
	require.Equal(t, 3600, cookie.MaxAge)
	b.cookies[sessionCookie] = cookie
	identity, status := b.me()
	require.Equal(t, http.StatusOK, status)
	require.Equal(t, guest, identity)
	_, err := b.auth.Token(context.Background(), "share/1")
	require.ErrorIs(t, err, ErrNoToken, "a session without a token")

	now = now.Add(time.Hour + time.Second)
	_, status = b.me()
	require.Equal(t, http.StatusUnauthorized, status, "ends at its end")
}

func TestSignedInUsersAreTheProvidersOnes(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	again := &browser{t: t, auth: b.auth, server: b.server, fake: b.fake, cookies: map[string]*http.Cookie{}}
	again.signIn("Ann", "/")
	other := &browser{t: t, auth: b.auth, server: b.server, fake: b.fake, cookies: map[string]*http.Cookie{}}
	other.signIn("Bob", "/")
	guest := Identity{Provider: "guest", Subject: "share/1", Name: "Jane (guest)"}
	b.auth.StartSession(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, server+"/api/public/guest/join", nil), guest, time.Now().Add(time.Hour))
	ann, _ := b.me()
	bob, _ := other.me()
	require.ElementsMatch(t, []string{ann.Subject, bob.Subject}, b.auth.SignedInUsers(), "each once, no guest")
}

func TestEndSessionsEndsTheMatchedOnly(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	other := &browser{t: t, auth: b.auth, server: b.server, fake: b.fake, cookies: map[string]*http.Cookie{}}
	other.signIn("Bob", "/")
	b.auth.EndSessions(func(identity Identity) bool { return identity.Name == "Bob" })
	_, status := other.me()
	require.Equal(t, http.StatusUnauthorized, status)
	_, status = b.me()
	require.Equal(t, http.StatusOK, status)
}
