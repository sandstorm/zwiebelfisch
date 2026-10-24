package config_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/config"
)

// origins is the one variable without a default.
const origins = "ZWF_ALLOWED_ORIGINS=https://editor.example.org"

func TestDefaults(t *testing.T) {
	c, err := config.Load([]string{"HOME=/home/x", "ZWF_UNRELATED=1", origins})
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1", c.Address)
	require.Equal(t, 1234, c.Port)
	require.Equal(t, "server/.data/collab.sqlite", c.Collab.DB)
	require.Empty(t, c.Auth.Issuer, "no GitLab, no issuer")
	require.Empty(t, c.Auth.ClientID)
	require.Equal(t, "info", c.Log.Level)
	require.Equal(t, "console", c.Log.Format)
	require.False(t, c.Rooms.Plain, "plain rooms only when enabled")
	require.False(t, c.Rooms.Guests, "guest links only when enabled")
	require.Empty(t, c.GitLab.URL)
}

func TestEnvironment(t *testing.T) {
	c, err := config.Load([]string{
		"ZWF_ALLOWED_ORIGINS=https://Editor.Example.org:443, http://127.0.0.1:5199",
		"PORT=4321", "ZWF_ADDRESS=0.0.0.0", "ZWF_COLLAB_DB=:memory:",
		"ZWF_LOG_LEVEL=debug", "ZWF_LOG_FORMAT=json", "ZWF_PLAIN_ROOMS=1", "ZWF_GUESTS=true",
		"ZWF_GITLAB_URL=https://gitlab.example", "ZWF_GITLAB_WEBHOOK_SECRET=hook",
		"ZWF_GITLAB_AUTHOR_EMAIL=a@example.org", "ZWF_GITLAB_AUTO_COMMIT=off",
		"ZWF_AUTH_CLIENT_ID=app", "ZWF_AUTH_CLIENT_SECRET=s=1", "ZWF_AUTH_REDIRECT_URL=https://editor.example/api/public/auth/callback",
	})
	require.NoError(t, err)
	require.Equal(t, []string{"https://editor.example.org", "http://127.0.0.1:5199"}, c.AllowedOrigins)
	require.Equal(t, 4321, c.Port)
	require.True(t, c.Rooms.Guests)
	require.Equal(t, "0.0.0.0", c.Address)
	require.Equal(t, ":memory:", c.Collab.DB)
	require.Equal(t, "https://gitlab.example", c.Auth.Issuer, "the GitLab instance by default")
	require.Equal(t, "app", c.Auth.ClientID)
	require.Equal(t, "s=1", c.Auth.ClientSecret, "values may contain =")
	require.Equal(t, "https://editor.example/api/public/auth/callback", c.Auth.RedirectURL)
	require.Equal(t, "debug", c.Log.Level)
	require.Equal(t, "json", c.Log.Format)
	require.True(t, c.Rooms.Plain)
	require.Equal(t, "https://gitlab.example", c.GitLab.URL)
	require.Equal(t, "hook", c.GitLab.WebhookSecret)
	require.Equal(t, "a@example.org", c.GitLab.AuthorEmail)
	require.Equal(t, "off", c.GitLab.AutoCommit)
}

func TestPlainRoomsSwitch(t *testing.T) {
	for value, want := range map[string]bool{"1": true, "true": true, "0": false, "false": false, "": false} {
		c, err := config.Load([]string{"ZWF_PLAIN_ROOMS=" + value, origins})
		require.NoError(t, err, value)
		require.Equal(t, want, c.Rooms.Plain, value)
	}
	_, err := config.Load([]string{"ZWF_PLAIN_ROOMS=perhaps", origins})
	require.Error(t, err)
}

func TestAnotherIssuer(t *testing.T) {
	c, err := config.Load([]string{"ZWF_GITLAB_URL=https://gitlab.example", "ZWF_AUTH_ISSUER=https://id.example", origins})
	require.NoError(t, err)
	require.Equal(t, "https://id.example", c.Auth.Issuer)
}

func TestInvalid(t *testing.T) {
	for _, environ := range [][]string{{"PORT=http"}, {"PORT=0"}, {"PORT=70000"}, {"ZWF_LOG_FORMAT=xml"}} {
		_, err := config.Load(append(environ, origins))
		require.Error(t, err, environ)
	}
}

func TestAllowedOrigins(t *testing.T) {
	for value, want := range map[string][]string{
		"https://editor.example.org":                         {"https://editor.example.org"},
		"https://editor.example.org,http://localhost:5199":   {"https://editor.example.org", "http://localhost:5199"},
		" https://editor.example.org , http://[::1]:5199 ":   {"https://editor.example.org", "http://[::1]:5199"},
		"HTTPS://EDITOR.example.org:443,http://x.example:80": {"https://editor.example.org", "http://x.example"},
	} {
		c, err := config.Load([]string{"ZWF_ALLOWED_ORIGINS=" + value})
		require.NoError(t, err, value)
		require.Equal(t, want, c.AllowedOrigins, value)
	}
}

func TestAllowedOriginsAreRequiredAndExact(t *testing.T) {
	for _, environ := range [][]string{
		{}, {"ZWF_ALLOWED_ORIGINS="}, {"ZWF_ALLOWED_ORIGINS= "},
	} {
		_, err := config.Load(environ)
		require.ErrorContains(t, err, "ZWF_ALLOWED_ORIGINS is required", environ)
		require.ErrorContains(t, err, "e.g. ZWF_ALLOWED_ORIGINS=https://", environ)
	}
	for _, value := range []string{
		"*", "null", "editor.example.org", "ftp://editor.example.org", "ws://editor.example.org",
		"https://editor.example.org/", "https://editor.example.org/app", "https://editor.example.org?a",
		" , ", "https://editor.example.org#a", "https://user@editor.example.org", "https://*.example.org",
		"https://editor.example.org:99999", "https://editor.example.org,", "https://editor.example.org,,http://localhost:5199",
		"https://editor.example.org,*", "://x", "http://exa mple.org",
	} {
		_, err := config.Load([]string{"ZWF_ALLOWED_ORIGINS=" + value})
		require.ErrorContains(t, err, "ZWF_ALLOWED_ORIGINS: ", value)
		require.ErrorContains(t, err, "e.g. ZWF_ALLOWED_ORIGINS=https://", value)
	}
}
