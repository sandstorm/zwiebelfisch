package config_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/config"
)

func TestDefaults(t *testing.T) {
	c, err := config.Load([]string{"HOME=/home/x", "ZWF_UNRELATED=1"})
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1", c.Address)
	require.Equal(t, 1234, c.Port)
	require.Equal(t, "server/.data/collab.sqlite", c.Collab.DB)
	require.Empty(t, c.Auth.Issuer, "no GitLab, no issuer")
	require.Empty(t, c.Auth.ClientID)
	require.Equal(t, "info", c.Log.Level)
	require.Equal(t, "console", c.Log.Format)
	require.False(t, c.Rooms.Plain, "plain rooms only when enabled")
	require.Empty(t, c.GitLab.URL)
}

func TestEnvironment(t *testing.T) {
	c, err := config.Load([]string{
		"PORT=4321", "ZWF_ADDRESS=0.0.0.0", "ZWF_COLLAB_DB=:memory:",
		"ZWF_LOG_LEVEL=debug", "ZWF_LOG_FORMAT=json", "ZWF_PLAIN_ROOMS=1",
		"ZWF_GITLAB_URL=https://gitlab.example", "ZWF_GITLAB_TOKEN=bot", "ZWF_GITLAB_WEBHOOK_SECRET=hook",
		"ZWF_GITLAB_AUTHOR_EMAIL=a@example.org", "ZWF_GITLAB_AUTO_COMMIT=off",
		"ZWF_AUTH_CLIENT_ID=app", "ZWF_AUTH_CLIENT_SECRET=s=1", "ZWF_AUTH_REDIRECT_URL=https://editor.example/api/public/auth/callback",
	})
	require.NoError(t, err)
	require.Equal(t, 4321, c.Port)
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
	require.Equal(t, "bot", c.GitLab.Token)
	require.Equal(t, "hook", c.GitLab.WebhookSecret)
	require.Equal(t, "a@example.org", c.GitLab.AuthorEmail)
	require.Equal(t, "off", c.GitLab.AutoCommit)
}

func TestPlainRoomsSwitch(t *testing.T) {
	for value, want := range map[string]bool{"1": true, "true": true, "0": false, "false": false, "": false} {
		c, err := config.Load([]string{"ZWF_PLAIN_ROOMS=" + value})
		require.NoError(t, err, value)
		require.Equal(t, want, c.Rooms.Plain, value)
	}
	_, err := config.Load([]string{"ZWF_PLAIN_ROOMS=perhaps"})
	require.Error(t, err)
}

func TestAnotherIssuer(t *testing.T) {
	c, err := config.Load([]string{"ZWF_GITLAB_URL=https://gitlab.example", "ZWF_AUTH_ISSUER=https://id.example"})
	require.NoError(t, err)
	require.Equal(t, "https://id.example", c.Auth.Issuer)
}

func TestInvalid(t *testing.T) {
	for _, environ := range [][]string{{"PORT=http"}, {"PORT=0"}, {"PORT=70000"}, {"ZWF_LOG_FORMAT=xml"}} {
		_, err := config.Load(environ)
		require.Error(t, err, environ)
	}
}
