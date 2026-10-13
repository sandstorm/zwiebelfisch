package fakegitlab

// The fake GitLab's sign-in: an OpenID Connect provider, as GitLab is one, so the demo, the image and the
// e2e tests sign in without a real GitLab. Endpoints (GitLab's paths):
//
//	GET  /.well-known/openid-configuration  discovery
//	GET  /oauth/authorize                   the browser: signs in as ?user= or ?login_hint= at once, else a
//	                                        page asks for a name (no password: anyone is anyone)
//	POST /oauth/token                       code (+ PKCE verifier) → access token and ID token
//	GET  /oauth/discovery/keys              the key ID tokens are signed with (generated at start)
//	GET  /oauth/userinfo                    who the access token belongs to
//
// Every name is an account: the first sign-in as "Ann" creates her (ids from 2; 1 is the bot).

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

const (
	// ClientID and ClientSecret are the only application the fake knows (the server's).
	ClientID     = "typst-editor"
	ClientSecret = "fake-client-secret"
	keyID        = "fake-gitlab"
)

// User is an account of the fake.
type User struct {
	ID             int
	Username, Name string
	Email          string
}

// IdentityProvider is the fake's OpenID Connect provider (see above). Safe for concurrent use.
type IdentityProvider struct {
	issuer, authorizeURL string
	key                  *ecdsa.PrivateKey

	mu     sync.Mutex
	users  map[string]*User // by username
	codes  map[string]grant
	tokens map[string]*User // access tokens
}

type grant struct {
	user                       *User
	redirect, nonce, challenge string
	expires                    time.Time
}

// NewIdentityProvider returns a provider whose issuer is issuer and whose authorization endpoint (the page
// a browser is sent to) is authorizeURL: absolute, or a path on whatever host sent the browser there (the
// fake GitLab at URL is in-process only, so the playground server serves its page; package playground).
func NewIdentityProvider(issuer, authorizeURL string) *IdentityProvider {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err) // crypto/rand does not fail
	}
	return &IdentityProvider{
		issuer: strings.TrimSuffix(issuer, "/"), authorizeURL: authorizeURL, key: key,
		users: map[string]*User{}, codes: map[string]grant{}, tokens: map[string]*User{},
	}
}

// SignIn is the account named name, created on first use. Usernames are names in lower case.
func (p *IdentityProvider) SignIn(name string) User {
	p.mu.Lock()
	defer p.mu.Unlock()
	return *p.user(name)
}

func (p *IdentityProvider) user(name string) *User {
	username := strings.ToLower(strings.Join(strings.Fields(name), "."))
	u := p.users[username]
	if u == nil {
		u = &User{ID: len(p.users) + 2, Username: username, Name: name, Email: username + "@gitlab.test"}
		p.users[username] = u
	}
	return u
}

// UserByID is the account with id (false: none).
func (p *IdentityProvider) UserByID(id int) (User, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, u := range p.users {
		if u.ID == id {
			return *u, true
		}
	}
	return User{}, false
}

// ServeHTTP answers the endpoints above.
func (p *IdentityProvider) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/.well-known/openid-configuration":
		p.discovery(w)
	case r.Method == http.MethodGet && r.URL.Path == "/oauth/authorize":
		p.authorize(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/oauth/token":
		p.token(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/oauth/discovery/keys":
		reply(w, http.StatusOK, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &p.key.PublicKey, KeyID: keyID, Algorithm: string(jose.ES256), Use: "sig"}}})
	case r.Method == http.MethodGet && r.URL.Path == "/oauth/userinfo":
		p.userinfo(w, r)
	default:
		fail(w, http.StatusNotFound, "404 Not Found")
	}
}

func (p *IdentityProvider) discovery(w http.ResponseWriter) {
	reply(w, http.StatusOK, map[string]any{
		"issuer":                                p.issuer,
		"authorization_endpoint":                p.authorizeURL,
		"token_endpoint":                        p.issuer + "/oauth/token",
		"userinfo_endpoint":                     p.issuer + "/oauth/userinfo",
		"jwks_uri":                              p.issuer + "/oauth/discovery/keys",
		"response_types_supported":              []string{"code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{string(jose.ES256)},
		"scopes_supported":                      []string{"openid", "profile", "email", "read_api", "read_user"},
		"code_challenge_methods_supported":      []string{"plain", "S256"},
	})
}

func (p *IdentityProvider) authorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	redirect, err := url.Parse(q.Get("redirect_uri"))
	switch {
	case q.Get("client_id") != ClientID:
		http.Error(w, "Unknown client_id", http.StatusBadRequest)
		return
	case err != nil || (redirect.Scheme != "http" && redirect.Scheme != "https"):
		http.Error(w, "Invalid redirect_uri", http.StatusBadRequest)
		return
	case q.Get("response_type") != "code" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "":
		http.Error(w, "Expected response_type=code with an S256 code_challenge", http.StatusBadRequest)
		return
	}
	// the page's form sends its Name field and the name button clicked (user=&user=Cleo): the first name given
	name := ""
	for _, n := range append(q["user"], q.Get("login_hint")) {
		if name = strings.TrimSpace(n); name != "" {
			break
		}
	}
	if name == "" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = signInPage.Execute(w, q)
		return
	}
	code := rand.Text()
	p.mu.Lock()
	p.codes[code] = grant{p.user(name), redirect.String(), q.Get("nonce"), q.Get("code_challenge"), time.Now().Add(time.Minute)}
	p.mu.Unlock()
	back := redirect.Query()
	back.Set("code", code)
	back.Set("state", q.Get("state"))
	redirect.RawQuery = back.Encode()
	http.Redirect(w, r, redirect.String(), http.StatusFound)
}

// signInPage asks for a name, keeping the authorization request's parameters.
var signInPage = template.Must(template.New("signin").Funcs(template.FuncMap{
	"names": func() []string { return []string{"Ann", "Bob", "Cleo", "Dan"} },
}).Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign in to the fake GitLab</title>
<style>body{font:16px system-ui,sans-serif;max-width:28em;margin:4em auto;padding:0 1em}button,input{font:inherit;padding:.3em .6em}</style>
</head><body>
<h1>Sign in to the fake GitLab</h1>
<p>No password: pick anyone (a private window keeps a second user apart).</p>
<form method="get" aria-label="Sign in">
{{range $name, $values := .}}{{if ne $name "user"}}{{range $values}}<input type="hidden" name="{{$name}}" value="{{.}}">{{end}}{{end}}{{end}}
<p><label>Name <input name="user" autofocus></label> <button>Sign in</button></p>
<p>{{range $name := names}}<button name="user" value="{{$name}}">{{$name}}</button> {{end}}</p>
</form></body></html>
`))

func (p *IdentityProvider) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		oauthError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	id, secret, basic := r.BasicAuth()
	if !basic {
		id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	}
	if id != ClientID || subtle.ConstantTimeCompare([]byte(secret), []byte(ClientSecret)) != 1 {
		oauthError(w, http.StatusUnauthorized, "invalid_client")
		return
	}
	if r.PostForm.Get("grant_type") != "authorization_code" {
		oauthError(w, http.StatusBadRequest, "unsupported_grant_type")
		return
	}
	code := r.PostForm.Get("code")
	p.mu.Lock()
	g, ok := p.codes[code]
	delete(p.codes, code)
	p.mu.Unlock()
	challenge := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
	if !ok || time.Now().After(g.expires) || g.redirect != r.PostForm.Get("redirect_uri") ||
		base64.RawURLEncoding.EncodeToString(challenge[:]) != g.challenge {
		oauthError(w, http.StatusBadRequest, "invalid_grant")
		return
	}
	idToken, err := p.idToken(g)
	if err != nil {
		oauthError(w, http.StatusInternalServerError, "server_error")
		return
	}
	access := rand.Text()
	p.mu.Lock()
	p.tokens[access] = g.user
	p.mu.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	reply(w, http.StatusOK, map[string]any{
		"access_token": access, "token_type": "Bearer", "expires_in": 7200, "refresh_token": rand.Text(),
		"scope": "openid profile email read_api", "id_token": idToken, "created_at": time.Now().Unix(),
	})
}

// idToken is g's ID token, signed with the provider's key.
func (p *IdentityProvider) idToken(g grant) (string, error) {
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: p.key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", keyID))
	if err != nil {
		return "", err
	}
	now := time.Now()
	claims := profile(g.user)
	claims["iss"], claims["aud"], claims["iat"], claims["exp"] = p.issuer, ClientID, now.Unix(), now.Add(10*time.Minute).Unix()
	if g.nonce != "" {
		claims["nonce"] = g.nonce
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		return "", err
	}
	return signed.CompactSerialize()
}

func profile(u *User) map[string]any {
	return map[string]any{
		"sub": strconv.Itoa(u.ID), "name": u.Name, "nickname": u.Username, "preferred_username": u.Username,
		"email": u.Email, "email_verified": true,
	}
}

func (p *IdentityProvider) userinfo(w http.ResponseWriter, r *http.Request) {
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	p.mu.Lock()
	u := p.tokens[token]
	p.mu.Unlock()
	if u == nil {
		fail(w, http.StatusUnauthorized, "401 Unauthorized")
		return
	}
	reply(w, http.StatusOK, profile(u))
}

func oauthError(w http.ResponseWriter, status int, code string) {
	reply(w, status, map[string]string{"error": code})
}
