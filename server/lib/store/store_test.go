package store_test

import (
	"path/filepath"
	"testing"
	"time"

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

func TestSharesAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "collab.sqlite")
	s, err := store.Open(path)
	require.NoError(t, err)
	at := time.UnixMilli(time.Now().UnixMilli())
	share := store.Share{
		ID: "s1", TokenHash: []byte{1, 2}, Room: "gitlab:a@main", Label: "ACME", CreatorProvider: "gitlab", CreatorID: "7",
		CreatorName: "Ann", CreatedAt: at, ExpiresAt: at.Add(time.Hour),
	}
	require.NoError(t, s.AddShare(share))
	require.Error(t, s.AddShare(store.Share{ID: "s2", TokenHash: []byte{1, 2}}), "a token hash is unique")
	require.NoError(t, s.Close())

	s, err = store.Open(path)
	require.NoError(t, err)
	defer s.Close()
	shares, err := s.Shares()
	require.NoError(t, err)
	require.Len(t, shares, 1)
	require.True(t, shares[0].ExpiresAt.Equal(share.ExpiresAt))
	shares[0].CreatedAt, shares[0].ExpiresAt = share.CreatedAt, share.ExpiresAt
	require.Equal(t, share, shares[0])
	require.NoError(t, s.DeleteShare("s1"))
	shares, err = s.Shares()
	require.NoError(t, err)
	require.Empty(t, shares)
}
