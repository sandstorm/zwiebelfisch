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

func TestUserRooms(t *testing.T) {
	s, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer s.Close()
	at := func(minute int) time.Time {
		return time.UnixMilli(time.Date(2026, 10, 25, 10, minute, 0, 0, time.UTC).UnixMilli())
	}
	rooms := func(user string) []store.UserRoom {
		r, err := s.UserRooms(user)
		require.NoError(t, err)
		return r
	}

	require.NoError(t, s.OpenedRoom("gitlab:1", "a", at(1), 2))
	require.NoError(t, s.OpenedRoom("gitlab:1", "b", at(2), 2))
	require.NoError(t, s.OpenedRoom("gitlab:2", "a", at(3), 2))
	require.NoError(t, s.PinRoom("gitlab:1", "a", true))
	require.NoError(t, s.OpenedRoom("gitlab:1", "c", at(4), 2))
	require.NoError(t, s.OpenedRoom("gitlab:1", "d", at(5), 2))
	require.Equal(t, []store.UserRoom{
		{Room: "d", LastOpened: at(5)}, {Room: "c", LastOpened: at(4)}, {Room: "a", LastOpened: at(1), Pinned: true},
	}, rooms("gitlab:1"), "b is forgotten: the two latest unpinned stay, and the pinned one")
	require.Equal(t, []store.UserRoom{{Room: "a", LastOpened: at(3)}}, rooms("gitlab:2"))

	require.NoError(t, s.ForgetRoom("gitlab:1", "a"))
	require.NoError(t, s.ForgetRoom("gitlab:1", "c"))
	require.NoError(t, s.PinRoom("gitlab:1", "never-opened", true))
	require.Equal(t, []store.UserRoom{
		{Room: "d", LastOpened: at(5)}, {Room: "a", Pinned: true}, {Room: "never-opened", Pinned: true},
	}, rooms("gitlab:1"), "a pinned room taken off the recent list stays pinned")

	require.NoError(t, s.PinRoom("gitlab:1", "a", false))
	require.NoError(t, s.PinRoom("gitlab:1", "d", false))
	require.Equal(t, []store.UserRoom{{Room: "d", LastOpened: at(5)}, {Room: "never-opened", Pinned: true}}, rooms("gitlab:1"))
}

func TestTeamPins(t *testing.T) {
	s, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer s.Close()
	at := time.UnixMilli(time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC).UnixMilli())
	require.NoError(t, s.SetTeamPin("a", "Ann", at, true))
	require.NoError(t, s.SetTeamPin("b", "Bob", at.Add(time.Minute), true))
	require.NoError(t, s.SetTeamPin("a", "Cid", at.Add(2*time.Minute), true))
	pins, err := s.TeamPins()
	require.NoError(t, err)
	require.Equal(t, []store.TeamPin{{Room: "a", By: "Cid", At: at.Add(2 * time.Minute)}, {Room: "b", By: "Bob", At: at.Add(time.Minute)}}, pins)
	require.NoError(t, s.SetTeamPin("a", "", at, false))
	pins, err = s.TeamPins()
	require.NoError(t, err)
	require.Equal(t, []store.TeamPin{{Room: "b", By: "Bob", At: at.Add(time.Minute)}}, pins)
}
