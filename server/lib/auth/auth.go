// Package auth signs people in with an OpenID Connect provider (by default the GitLab instance) and tells
// the rest of the server who sent a request: Identify, from the session cookie. Its handlers (package app
// mounts them):
//
//	Login     GET  /api/public/auth/login?return=<url>[&login_hint=<name>]  to the provider; afterwards back to <url> (this host only)
//	Callback  GET  /api/public/auth/callback  the provider's redirect: starts the session
//	Logout    POST /api/auth/logout           ends it (signed in only)
//	Me        GET  /api/me                    the Identity (signed in only)
//
// Guarantees:
//   - A sign-in finishes only in the browser that began it.
//   - Sessions, with the user's tokens, live in this process's memory only: nothing secret is stored, and a
//     restart signs everyone out.
//   - A request whose Origin is another host is never identified, a WebSocket included: the app's page and
//     the server must be on the same host (ports may differ).
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/rs/zerolog"
	"golang.org/x/oauth2"
)

// Options configure Auth. Provider, Issuer, ClientID and ClientSecret are required.
type Options struct {
	// Provider is the provider id, the first half of every Identity (e.g. "gitlab", as in GitLab room
	// names).
	Provider string
	// Issuer is the OpenID Connect issuer: its discovery document is at <Issuer>/.well-known/openid-configuration.
	Issuer string
	// ClientID and ClientSecret are the application registered at the provider.
	ClientID, ClientSecret string
	// RedirectURL is the callback as registered at the provider
	// (https://editor.example.org/api/public/auth/callback). "": this host's CallbackPath, as the browser named
	// the host.
	RedirectURL string
	// Scopes asked for (default openid, profile, email).
	Scopes []string
	// Client makes the requests to the provider (default: one with a 30 s timeout).
	Client *http.Client
	Log    zerolog.Logger

	now func() time.Time // tests
}

// Identity is who signed in. (Provider, Subject) identifies them; with GitLab as the provider, Subject is
// the GitLab user id.
type Identity struct {
	Provider string `json:"provider"`
	Subject  string `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
}

// Auth is the sign-in and its sessions. Create it with New.
type Auth struct {
	opts Options

	mu       sync.Mutex
	provider *oidc.Provider // nil until discovered (on the first sign-in, so a server starts without it)
	verifier *oidc.IDTokenVerifier
	logins   map[string]login    // by state: sign-ins on their way through the provider
	sessions map[string]*session // by id (the cookie's value)
}

type login struct {
	nonce, verifier string
	redirect        string // the redirect URL sent with it (the token request repeats it)
	back            string // where to go afterwards
	expires         time.Time
}

type session struct {
	identity Identity
	// token is the user's access (and refresh) token, for calls in the user's name (the project chooser,
	// later). Here only: never written anywhere.
	token   *oauth2.Token
	expires time.Time
}

// CallbackPath is where the provider sends the browser back (Callback): the redirect URI to register, on this
// server's host.
const CallbackPath = "/api/public/auth/callback"

const (
	sessionCookie = "zwf_session"
	loginCookie   = "zwf_login"
	// SessionLifetime is how long a sign-in lasts (or until the server restarts).
	SessionLifetime = 7 * 24 * time.Hour
	loginLifetime   = 10 * time.Minute
	maxLogins       = 10_000 // sign-ins begun and not finished, at most (each costs memory until it expires)
)

// New returns the sign-in for o. The provider is asked for its configuration on the first sign-in.
func New(o Options) *Auth {
	if len(o.Scopes) == 0 {
		o.Scopes = []string{oidc.ScopeOpenID, "profile", "email"}
	}
	if o.Client == nil {
		o.Client = &http.Client{Timeout: 30 * time.Second}
	}
	if o.now == nil {
		o.now = time.Now
	}
	return &Auth{opts: o, logins: map[string]login{}, sessions: map[string]*session{}}
}

// Identify is who sent r: the session its cookie names. False without a session, with an expired one, or
// for a request from another host's page.
func (a *Auth) Identify(r *http.Request) (Identity, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || !SameSite(r) {
		return Identity{}, false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.sessions[cookie.Value]
	if s == nil {
		return Identity{}, false
	}
	if a.opts.now().After(s.expires) {
		delete(a.sessions, cookie.Value)
		return Identity{}, false
	}
	return s.identity, true
}

type identityKey struct{}

// WithIdentity is r for the handlers behind a sign-in check (Identify): SignedIn(r) is identity.
func WithIdentity(r *http.Request, identity Identity) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), identityKey{}, identity))
}

// SignedIn is who sent r, as the sign-in check put it there (WithIdentity); false for a request that did not
// pass one.
func SignedIn(r *http.Request) (Identity, bool) {
	identity, ok := r.Context().Value(identityKey{}).(Identity)
	return identity, ok
}

// SameSite reports whether r comes from a page of this host (any port), or names no page (no Origin: a
// navigation, or not a browser).
func SameSite(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Hostname() != "" && u.Hostname() == hostname(r.Host)
}

// AllowCredentials lets a page of this host on another port (the demo on :5199, the server on :1234) read
// the answer to a request that carries the cookie (fetch with credentials: 'include').
func AllowCredentials(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" && SameSite(r) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
}

// Login sends the browser to the provider to sign in (GET /api/public/auth/login).
func (a *Auth) Login(w http.ResponseWriter, r *http.Request) {
	provider, _, err := a.discover(r.Context())
	if err != nil {
		a.opts.Log.Error().Err(err).Str("issuer", a.opts.Issuer).Msg("cannot reach the sign-in provider")
		http.Error(w, "The sign-in provider cannot be reached; try again later.", http.StatusBadGateway)
		return
	}
	query := r.URL.Query()
	state := rand.Text()
	l := login{
		nonce: rand.Text(), verifier: oauth2.GenerateVerifier(), redirect: a.redirectURL(r),
		back: returnURL(r, query.Get("return")), expires: a.opts.now().Add(loginLifetime),
	}
	if !a.begin(state, l) {
		http.Error(w, "Too many sign-ins at once; try again in a few minutes.", http.StatusServiceUnavailable)
		return
	}
	http.SetCookie(w, cookie(r, loginCookie, state, "/api/public/auth/", loginLifetime))
	options := []oauth2.AuthCodeOption{oidc.Nonce(l.nonce), oauth2.S256ChallengeOption(l.verifier)}
	if hint := query.Get("login_hint"); hint != "" {
		options = append(options, oauth2.SetAuthURLParam("login_hint", hint))
	}
	http.Redirect(w, r, a.config(provider, l.redirect).AuthCodeURL(state, options...), http.StatusFound)
}

// Callback is where the provider sends the browser back (CallbackPath): it starts the session.
func (a *Auth) Callback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	state := query.Get("state")
	l, ok := a.finish(state)
	began, err := r.Cookie(loginCookie)
	if !ok || err != nil || subtle.ConstantTimeCompare([]byte(began.Value), []byte(state)) != 1 {
		http.Error(w, "This sign-in expired or began elsewhere: sign in again.", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, cookie(r, loginCookie, "", "/api/public/auth/", -1))
	if refused := query.Get("error"); refused != "" {
		http.Error(w, "Sign-in refused: "+first(query.Get("error_description"), refused), http.StatusForbidden)
		return
	}
	identity, token, err := a.exchange(r.Context(), l, query.Get("code"))
	if err != nil {
		a.opts.Log.Warn().Err(err).Msg("sign-in failed")
		http.Error(w, "Sign-in failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	id := rand.Text()
	a.mu.Lock()
	a.prune()
	a.sessions[id] = &session{identity: identity, token: token, expires: a.opts.now().Add(SessionLifetime)}
	a.mu.Unlock()
	a.opts.Log.Info().Str("provider", identity.Provider).Str("user", identity.Subject).Str("name", identity.Name).Msg("signed in")
	http.SetCookie(w, cookie(r, sessionCookie, id, "/", SessionLifetime))
	http.Redirect(w, r, l.back, http.StatusSeeOther)
}

// exchange trades the code for tokens and reads who signed in from the verified ID token (the provider's
// userinfo when the token names nobody).
func (a *Auth) exchange(ctx context.Context, l login, code string) (Identity, *oauth2.Token, error) {
	provider, verifier, err := a.discover(ctx)
	if err != nil {
		return Identity{}, nil, err
	}
	ctx = oidc.ClientContext(ctx, a.opts.Client)
	token, err := a.config(provider, l.redirect).Exchange(ctx, code, oauth2.VerifierOption(l.verifier))
	if err != nil {
		return Identity{}, nil, fmt.Errorf("the provider did not accept the code: %w", err)
	}
	raw, _ := token.Extra("id_token").(string)
	if raw == "" {
		return Identity{}, nil, errors.New("the provider sent no ID token")
	}
	idToken, err := verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, nil, err
	}
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(l.nonce)) != 1 {
		return Identity{}, nil, errors.New("the ID token is not for this sign-in (nonce)")
	}
	var claims profile
	if err := idToken.Claims(&claims); err != nil {
		return Identity{}, nil, err
	}
	if claims.Name == "" && provider.UserInfoEndpoint() != "" {
		info, err := provider.UserInfo(ctx, oauth2.StaticTokenSource(token))
		if err == nil && info.Subject == idToken.Subject {
			_ = info.Claims(&claims)
		}
	}
	username := first(claims.PreferredUsername, claims.Nickname)
	return Identity{
		Provider: a.opts.Provider, Subject: idToken.Subject,
		Name: first(claims.Name, username, idToken.Subject), Username: username, Email: claims.Email,
	}, token, nil
}

// profile are the standard claims an Identity is made of.
type profile struct {
	Name              string `json:"name"`
	PreferredUsername string `json:"preferred_username"`
	Nickname          string `json:"nickname"`
	Email             string `json:"email"`
}

// Logout ends the session (POST /api/auth/logout).
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		a.mu.Lock()
		delete(a.sessions, c.Value)
		a.mu.Unlock()
	}
	http.SetCookie(w, cookie(r, sessionCookie, "", "/", -1))
	w.WriteHeader(http.StatusNoContent)
}

// Me answers who signed in (GET /api/me): the Identity SignedIn finds, or 401.
func (a *Auth) Me(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	identity, ok := SignedIn(r)
	if !ok {
		http.Error(w, "Not signed in", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(identity)
}

// discover asks the provider for its configuration once (again after a failure).
func (a *Auth) discover(ctx context.Context) (*oidc.Provider, *oidc.IDTokenVerifier, error) {
	a.mu.Lock()
	provider, verifier := a.provider, a.verifier
	a.mu.Unlock()
	if provider != nil {
		return provider, verifier, nil
	}
	provider, err := oidc.NewProvider(oidc.ClientContext(ctx, a.opts.Client), a.opts.Issuer)
	if err != nil {
		return nil, nil, err
	}
	verifier = provider.VerifierContext(oidc.ClientContext(context.Background(), a.opts.Client), &oidc.Config{ClientID: a.opts.ClientID, Now: a.opts.now})
	a.mu.Lock()
	defer a.mu.Unlock()
	a.provider, a.verifier = provider, verifier
	return provider, verifier, nil
}

func (a *Auth) config(provider *oidc.Provider, redirect string) *oauth2.Config {
	return &oauth2.Config{
		ClientID: a.opts.ClientID, ClientSecret: a.opts.ClientSecret, Endpoint: provider.Endpoint(),
		RedirectURL: redirect, Scopes: a.opts.Scopes,
	}
}

func (a *Auth) redirectURL(r *http.Request) string {
	if a.opts.RedirectURL != "" {
		return a.opts.RedirectURL
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host + CallbackPath
}

// begin remembers a sign-in until the provider sends the browser back; false when too many are open.
func (a *Auth) begin(state string, l login) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.logins) >= maxLogins {
		a.prune()
		if len(a.logins) >= maxLogins {
			return false
		}
	}
	a.logins[state] = l
	return true
}

// finish takes the sign-in state names (once), unless it expired.
func (a *Auth) finish(state string) (login, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	l, ok := a.logins[state]
	delete(a.logins, state)
	return l, ok && a.opts.now().Before(l.expires)
}

// prune drops expired sign-ins and sessions. Called with mu held.
func (a *Auth) prune() {
	now := a.opts.now()
	for state, l := range a.logins {
		if now.After(l.expires) {
			delete(a.logins, state)
		}
	}
	for id, s := range a.sessions {
		if now.After(s.expires) {
			delete(a.sessions, id)
		}
	}
}

// returnURL is where to send the browser after signing in: raw if it is a path here or a URL of this host
// (any port: the demo runs on another), else "/" (never elsewhere: an open redirect).
func returnURL(r *http.Request, raw string) string {
	u, err := url.Parse(raw)
	switch {
	case raw == "" || err != nil || strings.ContainsAny(raw, "\\\r\n"):
		return "/"
	case u.Scheme == "" && u.Host == "" && strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//"):
		return raw
	case (u.Scheme == "http" || u.Scheme == "https") && u.User == nil && u.Hostname() == hostname(r.Host):
		return u.String()
	}
	return "/"
}

// cookie is one of ours; maxAge < 0 deletes it.
func cookie(r *http.Request, name, value, path string, maxAge time.Duration) *http.Cookie {
	age := int(maxAge.Seconds())
	if maxAge < 0 {
		age = -1
	}
	return &http.Cookie{
		Name: name, Value: value, Path: path, MaxAge: age,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: !loopback(r.Host),
	}
}

func loopback(host string) bool {
	h := hostname(host)
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// hostname is host without its port.
func hostname(host string) string {
	if h, _, err := net.SplitHostPort(host); err == nil {
		return strings.Trim(h, "[]")
	}
	return strings.Trim(host, "[]")
}

func first(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
