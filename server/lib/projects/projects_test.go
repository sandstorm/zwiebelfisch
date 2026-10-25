package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

var (
	ann   = collab.User{Provider: "gitlab", ID: "1", Name: "Ann"}
	bob   = collab.User{Provider: "gitlab", ID: "2", Name: "Bob"}
	guest = collab.User{Provider: collab.GuestProvider, ID: "g", Name: "Gus (guest)"}
)

type env struct {
	p        *Projects
	occupied map[string][]collab.User
	// rooms each user may open (by id); maintainers may team-pin any of theirs
	may         map[string][]string
	maintainers map[string]bool
	clock       time.Time
}

func setup(t *testing.T) *env {
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	t.Cleanup(func() { _ = st.Close() })
	e := &env{occupied: map[string][]collab.User{}, may: map[string][]string{}, maintainers: map[string]bool{},
		clock: time.UnixMilli(time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC).UnixMilli())}
	may := func(_ context.Context, user collab.User, room string) (bool, error) {
		for _, r := range e.may[user.ID] {
			if r == room {
				return true, nil
			}
		}
		return false, nil
	}
	e.p = New(Options{
		Store: st, Occupied: func() map[string][]collab.User { return e.occupied }, MayOpen: may,
		MayTeamPin: func(ctx context.Context, user collab.User, room string) (bool, error) {
			ok, err := may(ctx, user, room)
			return ok && e.maintainers[user.ID], err
		},
		Log: zerolog.Nop(), now: func() time.Time { return e.clock },
	})
	return e
}

func (e *env) open(user collab.User, room string) {
	e.clock = e.clock.Add(time.Minute)
	e.p.Opened(room, user)
}

func (e *env) call(t *testing.T, handler func(http.ResponseWriter, *http.Request, collab.User), user collab.User, method, room string) int {
	req := httptest.NewRequest(method, "/", nil)
	req.SetPathValue("room", room)
	res := httptest.NewRecorder()
	handler(res, req, user)
	return res.Code
}

func (e *env) rooms(t *testing.T, user collab.User) List {
	res := httptest.NewRecorder()
	e.p.Rooms(res, httptest.NewRequest("GET", "/", nil), user)
	require.Equal(t, http.StatusOK, res.Code)
	var list List
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &list))
	return list
}

func rooms(entries []Entry) []string {
	names := []string{}
	for _, e := range entries {
		names = append(names, e.Room)
	}
	return names
}

func TestRecentAndPinned(t *testing.T) {
	e := setup(t)
	require.Equal(t, List{Open: []Entry{}, Pinned: []Entry{}, Recent: []Entry{}}, e.rooms(t, ann))

	e.open(ann, "a")
	e.open(ann, "b")
	e.open(guest, "a")
	e.open(bob, "c")
	list := e.rooms(t, ann)
	require.Equal(t, []string{"b", "a"}, rooms(list.Recent), "latest first; another's and a guest's not")
	require.Equal(t, e.clock.Add(-2*time.Minute).UnixMilli(), list.Recent[0].LastOpened)

	require.Equal(t, http.StatusNoContent, e.call(t, e.p.Pin, ann, "PUT", "a"))
	list = e.rooms(t, ann)
	require.Equal(t, []string{"a"}, rooms(list.Pinned))
	require.True(t, list.Pinned[0].Pinned)
	require.Equal(t, []string{"b"}, rooms(list.Recent), "each room once")

	require.Equal(t, http.StatusNoContent, e.call(t, e.p.Forget, ann, "DELETE", "b"))
	require.Equal(t, http.StatusNoContent, e.call(t, e.p.Pin, ann, "DELETE", "a"))
	require.Equal(t, []string{"a"}, rooms(e.rooms(t, ann).Recent))
}

func TestOpenNowAndTeamPinsOnlyForWhoMayOpenThem(t *testing.T) {
	e := setup(t)
	e.may["1"] = []string{"report", "letters"}
	e.may["2"] = []string{"report", "letters", "secret"}
	e.maintainers["2"] = true
	e.occupied["report"] = []collab.User{bob, guest}
	e.occupied["secret"] = []collab.User{bob}

	list := e.rooms(t, ann)
	require.Equal(t, []string{"report"}, rooms(list.Open))
	require.Equal(t, []string{"Bob", "Gus (guest)"}, list.Open[0].People)

	require.Equal(t, http.StatusForbidden, e.call(t, e.p.TeamPin, ann, "PUT", "letters"), "not a Maintainer")
	require.Equal(t, http.StatusForbidden, e.call(t, e.p.TeamPin, bob, "PUT", "elsewhere"), "not one of Bob's")
	require.Equal(t, http.StatusNoContent, e.call(t, e.p.TeamPin, bob, "PUT", "letters"))
	require.Equal(t, http.StatusNoContent, e.call(t, e.p.TeamPin, bob, "PUT", "secret"))
	list = e.rooms(t, ann)
	require.Equal(t, []string{"letters"}, rooms(list.Pinned))
	require.Equal(t, "Bob", list.Pinned[0].TeamPinBy)
	require.False(t, list.Pinned[0].Pinned)
	require.Equal(t, []string{"report", "secret"}, rooms(e.rooms(t, bob).Open))

	require.Equal(t, http.StatusNoContent, e.call(t, e.p.TeamPin, bob, "DELETE", "letters"))
	require.Empty(t, e.rooms(t, ann).Pinned)
}
