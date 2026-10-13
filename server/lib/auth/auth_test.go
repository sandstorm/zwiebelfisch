package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
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
	fake    *fakegitlab.GitLab
	cookies map[string]*http.Cookie
	origin  string // the page's (sent as Origin), "" for navigations
}

func newBrowser(t *testing.T, o Options) *browser {
	fake := fakegitlab.New("demo/report", fakegitlab.Files{"/main.typ": []byte("x")})
	o.Provider, o.Issuer, o.ClientID, o.ClientSecret = "gitlab", fakegitlab.URL, fakegitlab.ClientID, fakegitlab.ClientSecret
	o.Client, o.Log = fake.Client(), zerolog.Nop()
	return &browser{t: t, auth: New(o), fake: fake, cookies: map[string]*http.Cookie{}}
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
		b.auth.ServeHTTP(res, req)
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
	return b.follow(server + "/auth/login?" + url.Values{"return": {back}, "login_hint": {name}}.Encode())
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
	require.Equal(t, "http://127.0.0.1:5199/?room=gitlab%3Ademo%2Freport%40main", res.Header().Get("Location"), "back where it began (another port of this host)")
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
	res := b.do(http.MethodGet, server+"/auth/login?return=/")
	require.Equal(t, http.StatusFound, res.Code)
	page := b.do(http.MethodGet, server+res.Header().Get("Location"))
	require.Equal(t, http.StatusOK, page.Code)
	require.Contains(t, page.Body.String(), `<input name="user"`)
	require.Contains(t, page.Body.String(), `name="state"`, "the request's parameters stay in the form")
}

func TestSecureCookiesOffLoopback(t *testing.T) {
	b := newBrowser(t, Options{})
	res := b.do(http.MethodGet, "https://editor.example.org/auth/login?return=/")
	require.Equal(t, http.StatusFound, res.Code)
	require.True(t, b.cookies[loginCookie].Secure)
	require.Contains(t, res.Header().Get("Location"), url.QueryEscape("https://editor.example.org/auth/callback"), "the callback on the host the browser named")
}

func TestRedirectURLFromConfig(t *testing.T) {
	b := newBrowser(t, Options{RedirectURL: "https://editor.example.org/auth/callback"})
	res := b.do(http.MethodGet, server+"/auth/login")
	require.Contains(t, res.Header().Get("Location"), "redirect_uri="+url.QueryEscape("https://editor.example.org/auth/callback"))
	require.Contains(t, res.Header().Get("Location"), "code_challenge_method=S256")
	require.Contains(t, res.Header().Get("Location"), "nonce=")
}

func TestCallbackRefusals(t *testing.T) {
	t.Run("a callback this browser did not begin (no or another login cookie)", func(t *testing.T) {
		victim, attacker := newBrowser(t, Options{}), newBrowser(t, Options{})
		attacker.auth = victim.auth // the same server
		attacker.fake = victim.fake
		res := attacker.do(http.MethodGet, server+"/auth/login?login_hint=Mallory")
		callback := attacker.do(http.MethodGet, server+res.Header().Get("Location")).Header().Get("Location")
		res = victim.do(http.MethodGet, callback)
		require.Equal(t, http.StatusBadRequest, res.Code)
		_, status := victim.me()
		require.Equal(t, http.StatusUnauthorized, status, "not signed in as Mallory")
	})

	t.Run("a callback used twice", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/auth/login?login_hint=Ann")
		callback := b.do(http.MethodGet, server+res.Header().Get("Location")).Header().Get("Location")
		login := b.cookies[loginCookie]
		require.Equal(t, http.StatusSeeOther, b.do(http.MethodGet, callback).Code)
		b.cookies[loginCookie] = login
		require.Equal(t, http.StatusBadRequest, b.do(http.MethodGet, callback).Code)
	})

	t.Run("the provider refused", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/auth/login")
		state := mustQuery(t, res.Header().Get("Location")).Get("state")
		res = b.do(http.MethodGet, server+"/auth/callback?"+url.Values{"state": {state}, "error": {"access_denied"}, "error_description": {"The user denied it"}}.Encode())
		require.Equal(t, http.StatusForbidden, res.Code)
		require.Contains(t, res.Body.String(), "The user denied it")
	})

	t.Run("a code the provider does not know", func(t *testing.T) {
		b := newBrowser(t, Options{})
		res := b.do(http.MethodGet, server+"/auth/login")
		state := mustQuery(t, res.Header().Get("Location")).Get("state")
		res = b.do(http.MethodGet, server+"/auth/callback?"+url.Values{"state": {state}, "code": {"forged"}}.Encode())
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
	req := httptest.NewRequest(http.MethodGet, "http://editor.example.org/auth/login", nil)
	for raw, want := range map[string]string{
		"":                                    "/",
		"/projects?x=1#a":                     "/projects?x=1#a",
		"http://editor.example.org:5199/?a=b": "http://editor.example.org:5199/?a=b",
		"https://editor.example.org/x":        "https://editor.example.org/x",
		"https://evil.example/":               "/",
		"//evil.example/":                     "/",
		"/\\evil.example":                     "/",
		"javascript:alert(1)":                 "/",
		"https://user@editor.example.org/":    "/",
	} {
		require.Equal(t, want, returnURL(req, raw), raw)
	}
}

func TestLogout(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	session := b.cookies[sessionCookie]
	require.Equal(t, http.StatusNoContent, b.do(http.MethodPost, server+"/auth/logout").Code)
	require.NotContains(t, b.cookies, sessionCookie)
	b.cookies[sessionCookie] = session // a copy kept elsewhere is worth nothing now
	_, status := b.me()
	require.Equal(t, http.StatusUnauthorized, status)
}

func TestOtherSitesPagesAreNobody(t *testing.T) {
	b := newBrowser(t, Options{})
	b.signIn("Ann", "/")
	b.origin = "http://127.0.0.1:5199" // the demo: same host, another port
	res := b.do(http.MethodGet, server+"/api/me")
	require.Equal(t, http.StatusOK, res.Code)
	require.Equal(t, "http://127.0.0.1:5199", res.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, "true", res.Header().Get("Access-Control-Allow-Credentials"))

	b.origin = "https://evil.example"
	res = b.do(http.MethodGet, server+"/api/me")
	require.Equal(t, http.StatusUnauthorized, res.Code)
	require.Empty(t, res.Header().Get("Access-Control-Allow-Origin"))
	require.Equal(t, http.StatusForbidden, b.do(http.MethodPost, server+"/auth/logout").Code)
	b.origin = ""
	_, status := b.me()
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
	a.ServeHTTP(res, httptest.NewRequest(http.MethodGet, server+"/auth/login", nil))
	require.Equal(t, http.StatusBadGateway, res.Code)
	require.Contains(t, res.Body.String(), "cannot be reached")
}
