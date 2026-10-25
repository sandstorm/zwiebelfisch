package app

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/projects"
)

// The start page's rooms through the whole server: a member's join makes a room recent and open now; a
// guest gets none of it.
func TestAJoinedRoomIsRecentAndOpenNow(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl, Guests: true})
	ann := signIn(t, fake, s, "Ann")
	rooms := func() projects.List {
		res := get(t, s, request("GET", host+"/api/me/rooms", ann))
		require.Equal(t, http.StatusOK, res.StatusCode)
		var list projects.List
		require.NoError(t, json.NewDecoder(res.Body).Decode(&list))
		return list
	}
	require.Empty(t, rooms().Recent)

	c := connect(t, s, ann)
	c.open(sharedRoom)
	c.eventually(t, sharedRoom, "authenticated")
	require.Eventually(t, func() bool { return len(rooms().Open) == 1 }, 5*time.Second, 5*time.Millisecond)
	list := rooms()
	require.Equal(t, sharedRoom, list.Open[0].Room)
	require.Equal(t, []string{"Ann"}, list.Open[0].People)
	require.NotZero(t, list.Open[0].LastOpened, "recent too, listed once: under Open")
	require.Empty(t, list.Recent)

	require.Equal(t, http.StatusForbidden, get(t, s, request("PUT", roomURL(sharedRoom, "/team-pin"), ann)).StatusCode,
		"a Developer does not pin for the team")
	fake.SetAccess("Mia", fakegitlab.Maintainer)
	mia := signIn(t, fake, s, "Mia")
	require.Equal(t, http.StatusNoContent, get(t, s, request("PUT", roomURL(sharedRoom, "/team-pin"), mia)).StatusCode)

	_, token := created(t, get(t, s, jsonRequest("POST", roomURL(sharedRoom, "/shares"), ann, `{"label":"ACME","days":1}`)))
	jane := joinAsGuest(t, s, token, "Jane")
	require.Equal(t, http.StatusForbidden, get(t, s, request("GET", host+"/api/me/rooms", jane)).StatusCode)
	require.Equal(t, http.StatusForbidden, get(t, s, request("GET", host+"/api/gitlab/projects?search=x", jane)).StatusCode)
}
