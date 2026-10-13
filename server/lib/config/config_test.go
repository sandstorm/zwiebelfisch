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
}

func TestEnvironment(t *testing.T) {
	c, err := config.Load([]string{
		"PORT=4321", "TYPST_ADDRESS=0.0.0.0", "TYPST_COLLAB_DB=:memory:", "TYPST_COLLAB_TOKEN=a=b",
		"TYPST_LOG_LEVEL=debug", "TYPST_LOG_FORMAT=json",
	})
	require.NoError(t, err)
	require.Equal(t, 4321, c.Port)
	require.Equal(t, "0.0.0.0", c.Address)
	require.Equal(t, ":memory:", c.Collab.DB)
	require.Equal(t, "a=b", *c.Collab.Token, "values may contain =")
	require.Equal(t, "debug", c.Log.Level)
	require.Equal(t, "json", c.Log.Format)
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
