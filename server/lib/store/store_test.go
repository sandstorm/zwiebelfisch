package store_test

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

func TestSaveLoadAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "collab.sqlite")
	s, err := store.Open(path)
	require.NoError(t, err)
	state, err := s.Load("report")
	require.NoError(t, err)
	require.Nil(t, state, "never stored")

	require.NoError(t, s.Save("report", []byte{1, 2, 3}))
	require.NoError(t, s.Save("report", []byte{4, 5}))
	require.NoError(t, s.Close())

	s, err = store.Open(path)
	require.NoError(t, err)
	defer s.Close()
	state, err = s.Load("report")
	require.NoError(t, err)
	require.Equal(t, []byte{4, 5}, state)
}

func TestMemoryKeepsWhileOpen(t *testing.T) {
	s, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer s.Close()
	require.NoError(t, s.Save("a", []byte("x")))
	state, err := s.Load("a")
	require.NoError(t, err)
	require.Equal(t, []byte("x"), state)
}
