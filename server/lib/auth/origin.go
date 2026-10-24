package auth

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// ParseOrigin is raw as the origin AllowedOrigin compares: scheme://host[:port], the scheme http or https,
// scheme and host lower-cased, the scheme's default port (80, 443) left out. An error for anything else:
// another scheme, user info, a path (also "/"), a query or fragment, no host, a port outside 1–65535, "*",
// "null".
//   - package config, for ZWF_ALLOWED_ORIGINS
//   - New, AllowedOrigin and the sign-in's return URL
func ParseOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	switch {
	case err != nil || u.Scheme != "http" && u.Scheme != "https":
		return "", fmt.Errorf("%q is not http://host[:port] or https://host[:port]", raw)
	case u.Opaque != "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.ForceQuery || u.RawQuery != "" ||
		strings.ContainsAny(raw, "#%*") || strings.HasSuffix(u.Host, ":"):
		return "", fmt.Errorf("%q is more than scheme://host[:port] (user info, a path, query or fragment, a wildcard)", raw)
	case u.Hostname() == "":
		return "", fmt.Errorf("%q has no host", raw)
	}
	host := strings.ToLower(u.Hostname())
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", fmt.Errorf("%q has no valid port", raw)
		}
		if !(u.Scheme == "http" && n == 80 || u.Scheme == "https" && n == 443) {
			return u.Scheme + "://" + net.JoinHostPort(host, strconv.Itoa(n)), nil
		}
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return u.Scheme + "://" + host, nil
}

// AllowedOrigin reports whether r may use the session: true without an Origin header (a navigation, or not a
// browser) or for an Origin equal to one of Options.AllowedOrigins (scheme, host and port, as ParseOrigin
// normalises them); false for anything else, "null" and a malformed Origin included.
//   - Identify, AllowCredentials and the sign-in's return URL
//   - the guest join (package guest)
//   - the WebSocket upgrade (package collab, through package app)
func (a *Auth) AllowedOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || a.allowed(origin)
}

// AllowCredentials lets an allowed page (AllowedOrigin) read the answer to a request that carries the cookie
// (fetch with credentials: 'include'): it sets Access-Control-Allow-Origin to the request's Origin.
//   - package app (requireSignIn, the CORS preflight), package guest (the join)
func (a *Auth) AllowCredentials(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Vary", "Origin")
	if origin := r.Header.Get("Origin"); origin != "" && a.allowed(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
}

// allowed reports whether origin, as ParseOrigin normalises it, is one of the allowed origins.
func (a *Auth) allowed(origin string) bool {
	o, err := ParseOrigin(origin)
	return err == nil && a.origins[o]
}
