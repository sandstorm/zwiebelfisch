// Package auth signs people in with an OpenID Connect provider (by default the GitLab instance) and tells
// the rest of the server who sent a request: Identify, from the session cookie. Its handlers (package app
// mounts them):
//
//	Login     GET  /api/public/auth/login?return=<url>[&login_hint=<name>]  to the provider; afterwards back to <url> (an allowed page only)
//	Callback  GET  /api/public/auth/callback  the provider's redirect: starts the session
//	Logout    POST /api/auth/logout           ends it (signed in only)
//	Me        GET  /api/me                    the Identity (signed in only)
//
// StartSession and EndSessions let the rest of the server sign in people the provider does not know (package
// guest's guests: sessions without a token, up to a given end).
//
// Token hands the rest of the server a signed-in user's OAuth access token (for calls in their name),
// refreshed when it expired.
//
// Guarantees:
//   - A sign-in finishes only in the browser that began it. A sign-in on its way keeps no state on the
//     server: it is in the login cookie, sealed with a key made at start (a restart only fails the sign-ins
//     on their way).
//   - Sessions, with the user's tokens, live in this process's memory only: no token is stored, logged or
//     put in an error, and a restart signs everyone out.
//   - Only a request from an allowed page (AllowedOrigin: the server's own host and port, or any loopback
//     page for a loopback server) is identified and may read the answers; nothing is configured.
package auth

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
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
	opts  Options
	login cipher.AEAD // seals the login cookie; its key lives in memory only

	mu       sync.Mutex
	provider *oidc.Provider // nil until discovered (on the first sign-in, so a server starts without it)
	verifier *oidc.IDTokenVerifier
	sessions map[string]*session // by id (the cookie's value)
}

// login is a sign-in on its way through the provider, sealed in the login cookie.
type login struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"` // PKCE
	Redirect string `json:"r"` // the redirect URL sent with it (the token request repeats it)
	Back     string `json:"b"` // where to go afterwards
	Expires  int64  `json:"e"` // Unix seconds
}

type session struct {
	identity Identity
	expires  time.Time

	mu    sync.Mutex    // one refresh at a time
	token *oauth2.Token // the user's access and refresh token; here only, never written anywhere
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
	key := make([]byte, 32)
	_, _ = rand.Read(key) // crypto/rand does not fail
	block, _ := aes.NewCipher(key)
	aead, _ := cipher.NewGCM(block)
	return &Auth{opts: o, login: aead, sessions: map[string]*session{}}
}

// Identify is who sent r: the session its cookie names. False without a session, with an expired one, or
// for a request from a page AllowedOrigin refuses.
func (a *Auth) Identify(r *http.Request) (Identity, bool) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || !AllowedOrigin(r) {
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

// AllowedOrigin reports whether r comes from a page that may use the session. True without an Origin (a
// navigation, or not a browser), for an Origin whose host and port are the request's Host (any scheme;
// ports 80 and 443 count as none), and for a loopback page sending to a loopback host (any ports: the demo
// on 127.0.0.1:5199, the server on 127.0.0.1:1234). False for anything else, another port of the same
// host included.
//   - Identify, AllowCredentials and the sign-in's return URL (package auth)
//   - the guest join (package guest)
//   - the WebSocket upgrade (package collab)
func AllowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.User == nil && allowedHost(u.Host, r.Host)
}

// AllowCredentials lets an allowed page (AllowedOrigin) of another origin, such as the demo on another
// loopback port, read the answer to a request that carries the cookie (fetch with credentials: 'include').
func AllowCredentials(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" && AllowedOrigin(r) {
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
	l := login{
		State: rand.Text(), Nonce: rand.Text(), Verifier: oauth2.GenerateVerifier(), Redirect: a.redirectURL(r),
		Back: returnURL(r, query.Get("return")), Expires: a.opts.now().Add(loginLifetime).Unix(),
	}
	http.SetCookie(w, cookie(r, loginCookie, a.seal(l), "/api/public/auth/", loginLifetime))
	options := []oauth2.AuthCodeOption{oidc.Nonce(l.Nonce), oauth2.S256ChallengeOption(l.Verifier)}
	if hint := query.Get("login_hint"); hint != "" {
		options = append(options, oauth2.SetAuthURLParam("login_hint", hint))
	}
	http.Redirect(w, r, a.config(provider, l.Redirect).AuthCodeURL(l.State, options...), http.StatusFound)
}

// Callback is where the provider sends the browser back (CallbackPath): it starts the session.
func (a *Auth) Callback(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	l, ok := a.began(r)
	if !ok || subtle.ConstantTimeCompare([]byte(l.State), []byte(query.Get("state"))) != 1 {
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
	http.Redirect(w, r, l.Back, http.StatusSeeOther)
}

// seal is l as the login cookie's value: encrypted and authenticated with the key made at start.
func (a *Auth) seal(l login) string {
	plain, _ := json.Marshal(l)
	nonce := make([]byte, a.login.NonceSize())
	_, _ = rand.Read(nonce)
	return base64.RawURLEncoding.EncodeToString(a.login.Seal(nonce, nonce, plain, []byte(loginCookie)))
}

// began is the sign-in r's login cookie seals, unless it is missing, forged or expired.
func (a *Auth) began(r *http.Request) (login, bool) {
	c, err := r.Cookie(loginCookie)
	if err != nil {
		return login{}, false
	}
	sealed, err := base64.RawURLEncoding.DecodeString(c.Value)
	n := a.login.NonceSize()
	if err != nil || len(sealed) < n {
		return login{}, false
	}
	plain, err := a.login.Open(nil, sealed[:n], sealed[n:], []byte(loginCookie))
	var l login
	if err != nil || json.Unmarshal(plain, &l) != nil {
		return login{}, false
	}
	return l, a.opts.now().Unix() < l.Expires
}

// exchange trades the code for tokens and reads who signed in from the verified ID token (the provider's
// userinfo when the token names nobody).
func (a *Auth) exchange(ctx context.Context, l login, code string) (Identity, *oauth2.Token, error) {
	provider, verifier, err := a.discover(ctx)
	if err != nil {
		return Identity{}, nil, err
	}
	ctx = oidc.ClientContext(ctx, a.opts.Client)
	token, err := a.config(provider, l.Redirect).Exchange(ctx, code, oauth2.VerifierOption(l.Verifier))
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
	if subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(l.Nonce)) != 1 {
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

// ErrNoToken: the user has no live session with a token that works (signed out, expired, or the provider
// refused the refresh).
var ErrNoToken = errors.New("auth: no live sign-in of this user")

// Token is an OAuth access token of the signed-in user subject (an Identity's Subject), from any of their
// live sessions; an expired one is refreshed first (one refresh per session at a time; a rotated refresh
// token replaces the old one in the session). ErrNoToken when none has a token that works.
func (a *Auth) Token(ctx context.Context, subject string) (string, error) {
	now := a.opts.now()
	var candidates []*session
	a.mu.Lock()
	for _, s := range a.sessions {
		if s.identity.Subject == subject && now.Before(s.expires) {
			candidates = append(candidates, s)
		}
	}
	a.mu.Unlock()
	for _, s := range candidates {
		token, err := a.fresh(ctx, s)
		if err == nil {
			return token, nil
		}
		a.opts.Log.Warn().Str("user", subject).Msg("cannot refresh a GitLab token: " + refreshFailure(err))
	}
	return "", ErrNoToken
}

// fresh is s's access token, refreshed if it expired. A refresh runs to its end (up to refreshTimeout) even
// when ctx ends first, so a rotated refresh token always lands in s.
func (a *Auth) fresh(ctx context.Context, s *session) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token == nil { // StartSession's
		return "", ErrNoToken
	}
	if s.token.Valid() {
		return s.token.AccessToken, nil
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), refreshTimeout)
	defer cancel()
	provider, _, err := a.discover(ctx)
	if err != nil {
		return "", err
	}
	token, err := a.config(provider, "").TokenSource(oidc.ClientContext(ctx, a.opts.Client), s.token).Token()
	if err != nil {
		return "", err
	}
	s.token = token
	return token.AccessToken, nil
}

// refreshTimeout bounds one refresh of an access token.
const refreshTimeout = 30 * time.Second

// refreshFailure is why a refresh failed, without anything the provider sent back.
func refreshFailure(err error) string {
	var refused *oauth2.RetrieveError
	if errors.As(err, &refused) {
		return "the provider refused (" + first(refused.ErrorCode, "no reason given") + ")"
	}
	return "the provider cannot be reached"
}

// StartSession signs the browser of r in as identity until expires (at most SessionLifetime from now), without
// a token (Token has none for it): a new session, its cookie set on w.
func (a *Auth) StartSession(w http.ResponseWriter, r *http.Request, identity Identity, expires time.Time) {
	now := a.opts.now()
	if longest := now.Add(SessionLifetime); expires.After(longest) {
		expires = longest
	}
	id := rand.Text()
	a.mu.Lock()
	a.prune()
	a.sessions[id] = &session{identity: identity, expires: expires}
	a.mu.Unlock()
	http.SetCookie(w, cookie(r, sessionCookie, id, "/", expires.Sub(now)))
}

// EndSessions ends every session whose identity match picks: their requests are no longer identified.
func (a *Auth) EndSessions(match func(Identity) bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for id, s := range a.sessions {
		if match(s.identity) {
			delete(a.sessions, id)
		}
	}
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

// prune drops expired sessions. Called with mu held.
func (a *Auth) prune() {
	now := a.opts.now()
	for id, s := range a.sessions {
		if now.After(s.expires) {
			delete(a.sessions, id)
		}
	}
}

// returnURL is where to send the browser after signing in: raw if it is a path here or a URL of a page
// AllowedOrigin allows (this host and port; any loopback page for a loopback host), else "/" (never
// elsewhere: an open redirect).
func returnURL(r *http.Request, raw string) string {
	u, err := url.Parse(raw)
	switch {
	case raw == "" || err != nil || strings.ContainsAny(raw, "\\\r\n"):
		return "/"
	case u.Scheme == "" && u.Host == "" && strings.HasPrefix(raw, "/") && !strings.HasPrefix(raw, "//"):
		return raw
	case (u.Scheme == "http" || u.Scheme == "https") && u.User == nil && allowedHost(u.Host, r.Host):
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

// allowedHost reports whether a page on page (host[:port]) may use the session of server (host[:port]):
// the same host and port, or both loopback.
func allowedHost(page, server string) bool {
	if page == "" {
		return false
	}
	return hostPort(page) == hostPort(server) || loopback(page) && loopback(server)
}

// hostPort is host and port lower-cased and without brackets, ports 80 and 443 dropped.
func hostPort(host string) string {
	port := ""
	if _, p, err := net.SplitHostPort(host); err == nil && p != "80" && p != "443" {
		port = p
	}
	return strings.ToLower(hostname(host)) + " " + port
}

func loopback(host string) bool {
	h := strings.ToLower(hostname(host))
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
