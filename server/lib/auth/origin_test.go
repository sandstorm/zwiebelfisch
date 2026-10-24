package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestParseOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://editor.example.org":         "https://editor.example.org",
		"HTTPS://Editor.Example.ORG":         "https://editor.example.org",
		"https://editor.example.org:443":     "https://editor.example.org",
		"http://editor.example.org:80":       "http://editor.example.org",
		"http://editor.example.org:443":      "http://editor.example.org:443",
		"https://editor.example.org:80":      "https://editor.example.org:80",
		"https://editor.example.org:8443":    "https://editor.example.org:8443",
		"http://127.0.0.1:5199":              "http://127.0.0.1:5199",
		"http://[::1]:5199":                  "http://[::1]:5199",
		"https://[2001:DB8::1]":              "https://[2001:db8::1]",
		"https://[2001:db8::1]:443":          "https://[2001:db8::1]",
		"http://localhost:05199":             "http://localhost:5199",
		"":                                   "",
		"*":                                  "",
		"null":                               "",
		"editor.example.org":                 "",
		"//editor.example.org":               "",
		"ftp://editor.example.org":           "",
		"ws://editor.example.org":            "",
		"https://editor.example.org/":        "",
		"https://editor.example.org/x":       "",
		"https://editor.example.org?":        "",
		"https://editor.example.org?a=b":     "",
		"https://editor.example.org#":        "",
		"https://editor.example.org#x":       "",
		"https://user@editor.example.org":    "",
		"https://user:pw@editor.example.org": "",
		"https://*.example.org":              "",
		"https://editor.example.org:":        "",
		"https://editor.example.org:0":       "",
		"https://editor.example.org:65536":   "",
		"https://editor.example.org:x":       "",
		"https://%65ditor.example.org":       "",
		"https://[fe80::1%25en0]":            "",
		"https://":                           "",
		"https://:443":                       "",
		"https://exa mple.org":               "",
		"://x":                               "",
		"javascript:alert(1)":                "",
		"http:editor.example.org":            "",
	} {
		got, err := ParseOrigin(raw)
		if want == "" {
			require.Error(t, err, raw)
			continue
		}
		require.NoError(t, err, raw)
		require.Equal(t, want, got, raw)
	}
}

func TestAllowedOrigin(t *testing.T) {
	a := New(Options{AllowedOrigins: []string{"https://editor.example.org", "http://127.0.0.1:5199", "https://[2001:db8::1]:8443"}})
	for origin, allowed := range map[string]bool{
		"":                                        true, // a navigation, or not a browser
		"https://editor.example.org":              true,
		"https://Editor.Example.org":              true,
		"https://editor.example.org:443":          true, // the default port
		"http://127.0.0.1:5199":                   true,
		"https://[2001:db8::1]:8443":              true,
		"https://editor.example.org:8443":         false, // another port
		"http://127.0.0.1:1234":                   false,
		"http://127.0.0.1":                        false,
		"http://editor.example.org":               false, // another scheme
		"https://127.0.0.1:5199":                  false,
		"https://evil.example":                    false, // another host
		"https://editor.example.org.evil.example": false,
		"http://localhost:5199":                   false, // loopback, but not listed
		"https://[2001:db8::1]:9443":              false,
		"null":                                    false, // an opaque origin (a sandboxed frame, a file)
		"://x":                                    false, // malformed
		"https://editor.example.org/":             false,
		"https://user@editor.example.org":         false,
		"*":                                       false,
	} {
		// the request's Host plays no part: here it is the allowed page's own
		req := httptest.NewRequest(http.MethodGet, "https://editor.example.org/api/me", nil)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		require.Equal(t, allowed, a.AllowedOrigin(req), "%q", origin)

		res := httptest.NewRecorder()
		a.AllowCredentials(res, req)
		want := ""
		if allowed {
			want = origin
		}
		require.Equal(t, want, res.Header().Get("Access-Control-Allow-Origin"), "%q", origin)
	}
}

func TestNoAllowedOriginsAllowsOnlyRequestsWithoutOne(t *testing.T) {
	a := New(Options{})
	req := httptest.NewRequest(http.MethodGet, "https://editor.example.org/api/me", nil)
	require.True(t, a.AllowedOrigin(req))
	req.Header.Set("Origin", "https://editor.example.org")
	require.False(t, a.AllowedOrigin(req), "not even the server's own origin")
}

func TestNewRefusesAnInvalidOrigin(t *testing.T) {
	require.Panics(t, func() { New(Options{AllowedOrigins: []string{"https://editor.example.org/"}}) })
}

func TestReturnURL(t *testing.T) {
	a := New(Options{AllowedOrigins: []string{"https://editor.example.org", "http://127.0.0.1:5199"}})
	for raw, want := range map[string]string{
		"":                                   "/",
		"/projects?x=1#a":                    "/projects?x=1#a",
		"https://editor.example.org/x?a=b#c": "https://editor.example.org/x?a=b#c",
		"https://editor.example.org:443/x":   "https://editor.example.org:443/x",
		"http://127.0.0.1:5199/?room=a":      "http://127.0.0.1:5199/?room=a",
		"http://editor.example.org/x":        "/", // another scheme
		"https://editor.example.org:5199/":   "/", // another port
		"http://127.0.0.1:1234/":             "/",
		"http://localhost:5199/":             "/",
		"https://evil.example/":              "/",
		"//evil.example/":                    "/",
		"/\\evil.example":                    "/",
		"javascript:alert(1)":                "/",
		"https://user@editor.example.org/":   "/",
	} {
		require.Equal(t, want, a.returnURL(raw), raw)
	}
}
