package fakegitlab_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

// The fake's sign-in as a relying party sees it (package auth runs the whole flow against it).

func TestSignInChecksWhatGitLabChecks(t *testing.T) {
	g := newGitLab()
	verifier := "a-verifier-of-enough-length-for-pkce-0123456789"
	sum := sha256.Sum256([]byte(verifier))
	authorize := url.Values{
		"client_id": {fakegitlab.ClientID}, "redirect_uri": {"http://127.0.0.1:1234/api/public/auth/callback"}, "response_type": {"code"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"},
		"state": {"s"}, "nonce": {"n"}, "user": {"Ann"},
	}
	code := func() string {
		res := httptest.NewRecorder()
		g.IdentityProvider().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+authorize.Encode(), nil))
		require.Equal(t, http.StatusFound, res.Code, res.Body.String())
		back, err := url.Parse(res.Header().Get("Location"))
		require.NoError(t, err)
		require.Equal(t, "s", back.Query().Get("state"))
		return back.Query().Get("code")
	}
	token := func(form url.Values, secret string) *http.Response {
		req, err := http.NewRequest(http.MethodPost, fakegitlab.URL+"/oauth/token", strings.NewReader(form.Encode()))
		require.NoError(t, err)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.SetBasicAuth(fakegitlab.ClientID, secret)
		res, err := g.Client().Do(req)
		require.NoError(t, err)
		return res
	}
	exchange := func(c, v string) url.Values {
		return url.Values{"grant_type": {"authorization_code"}, "code": {c}, "code_verifier": {v}, "redirect_uri": authorize["redirect_uri"]}
	}

	require.Equal(t, http.StatusUnauthorized, token(exchange(code(), verifier), "wrong").StatusCode, "the client's secret")
	require.Equal(t, http.StatusBadRequest, token(exchange(code(), "another-verifier-of-enough-length-0123456789"), fakegitlab.ClientSecret).StatusCode, "PKCE")
	c := code()
	res := token(exchange(c, verifier), fakegitlab.ClientSecret)
	require.Equal(t, http.StatusOK, res.StatusCode)
	var tokens struct {
		AccessToken string `json:"access_token"`
		IDToken     string `json:"id_token"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&tokens))
	require.NotEmpty(t, tokens.IDToken)
	require.Equal(t, http.StatusBadRequest, token(exchange(c, verifier), fakegitlab.ClientSecret).StatusCode, "a code works once")

	req, err := http.NewRequest(http.MethodGet, fakegitlab.URL+"/oauth/userinfo", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+tokens.AccessToken)
	info, err := g.Client().Do(req)
	require.NoError(t, err)
	var profile map[string]any
	require.NoError(t, json.NewDecoder(info.Body).Decode(&profile))
	require.Equal(t, "Ann", profile["name"])
	require.Equal(t, "2", profile["sub"])
}

func TestTheSignInPageSignsInAsTheNamePicked(t *testing.T) {
	g := newGitLab()
	sum := sha256.Sum256([]byte("a-verifier-of-enough-length-for-pkce-0123456789"))
	authorize := url.Values{
		"client_id": {fakegitlab.ClientID}, "redirect_uri": {"http://127.0.0.1:1234/api/public/auth/callback"}, "response_type": {"code"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "state": {"s"},
	}
	page := httptest.NewRecorder()
	g.IdentityProvider().ServeHTTP(page, httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+authorize.Encode(), nil))
	require.Equal(t, http.StatusOK, page.Code)
	require.Contains(t, page.Body.String(), "Sign in to the fake GitLab")

	// the page's form sends its (empty) Name field and the name button clicked: user=&user=Cleo
	authorize["user"] = []string{"", "Cleo"}
	res := httptest.NewRecorder()
	g.IdentityProvider().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/oauth/authorize?"+authorize.Encode(), nil))
	require.Equal(t, http.StatusFound, res.Code, res.Body.String())
	require.True(t, strings.HasPrefix(res.Header().Get("Location"), "http://127.0.0.1:1234/api/public/auth/callback?"))
}

func TestMembersAndProtectedBranches(t *testing.T) {
	g := newGitLab()
	ann := g.SetAccess("Ann", fakegitlab.Reporter)
	g.Protect("main", fakegitlab.Maintainer)
	member := call(t, g, "GET", "/members/all/"+strconv.Itoa(ann.ID), nil)
	require.Equal(t, http.StatusOK, member.status)
	require.Equal(t, float64(fakegitlab.Reporter), member.json(t)["access_level"])
	require.Equal(t, http.StatusNotFound, call(t, g, "GET", "/members/all/999", nil).status)
	require.Equal(t, true, call(t, g, "GET", "/repository/branches/main", nil).json(t)["protected"])
	g.Push("draft", fakegitlab.Files{"/draft.typ": []byte("x")}, "Draft")
	require.Equal(t, false, call(t, g, "GET", "/repository/branches/draft", nil).json(t)["protected"])
}
