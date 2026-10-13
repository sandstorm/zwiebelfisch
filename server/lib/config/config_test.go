package config_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/config"
)

func TestDefaults(t *testing.T) {
	c, err := config.Load([]string{"HOME=/home/x", "TYPST_UNRELATED=1"})
	require.NoError(t, err)
	require.Equal(t, "127.0.0.1", c.Address)
	require.Equal(t, 1234, c.Port)
	require.Equal(t, "server/.data/collab.sqlite", c.Collab.DB)
	require.Nil(t, c.Collab.Token, "unset: no check")
	require.Equal(t, "info", c.Log.Level)
	require.Equal(t, "console", c.Log.Format)
	require.False(t, c.Rooms.Plain, "plain rooms only when enabled")
	require.Empty(t, c.GitLab.URL)
}

func TestEnvironment(t *testing.T) {
	c, err := config.Load([]string{
		"PORT=4321", "TYPST_ADDRESS=0.0.0.0", "TYPST_COLLAB_DB=:memory:", "TYPST_COLLAB_TOKEN=a=b",
		"TYPST_LOG_LEVEL=debug", "TYPST_LOG_FORMAT=json", "TYPST_PLAIN_ROOMS=1",
		"TYPST_GITLAB_URL=https://gitlab.example", "TYPST_GITLAB_TOKEN=bot", "TYPST_GITLAB_WEBHOOK_SECRET=hook",
		"TYPST_GITLAB_AUTHOR_EMAIL=a@example.org", "TYPST_GITLAB_AUTO_COMMIT=off",
	})
	require.NoError(t, err)
	require.Equal(t, 4321, c.Port)
	require.Equal(t, "0.0.0.0", c.Address)
	require.Equal(t, ":memory:", c.Collab.DB)
	require.Equal(t, "a=b", *c.Collab.Token, "values may contain =")
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
		c, err := config.Load([]string{"TYPST_PLAIN_ROOMS=" + value})
		require.NoError(t, err, value)
		require.Equal(t, want, c.Rooms.Plain, value)
	}
	_, err := config.Load([]string{"TYPST_PLAIN_ROOMS=perhaps"})
	require.Error(t, err)
}

func TestEmptyTokenStillChecks(t *testing.T) {
	c, err := config.Load([]string{"TYPST_COLLAB_TOKEN="})
	require.NoError(t, err)
	require.NotNil(t, c.Collab.Token, "set but empty is not unset")
	require.Empty(t, *c.Collab.Token)
}

func TestInvalid(t *testing.T) {
	for _, environ := range [][]string{{"PORT=http"}, {"PORT=0"}, {"PORT=70000"}, {"TYPST_LOG_FORMAT=xml"}} {
		_, err := config.Load(environ)
		require.Error(t, err, environ)
	}
}
