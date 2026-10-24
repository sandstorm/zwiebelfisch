package guest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const room = "gitlab:demo/report@main"

var ann = auth.Identity{Provider: "gitlab", Subject: "1", Name: "Ann"}

// fakeRooms records what Guests ask of the collaboration server.
type fakeRooms struct {
	mu          sync.Mutex
	broadcasts  []string // rooms
	disconnects []string // reasons
}

func (f *fakeRooms) BroadcastStateless(room, payload string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.broadcasts = append(f.broadcasts, room)
}

func (f *fakeRooms) Disconnect(match func(*collab.Peer) bool, reason string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.disconnects = append(f.disconnects, reason)
}

type world struct {
	t      *testing.T
	g      *Guests
	auth   *auth.Auth
	store  *store.Store
	rooms  *fakeRooms
	now    time.Time
	mu     sync.Mutex
	may    map[string]bool  // by creator id: what MayShare answers (missing: true)
	mayErr map[string]error // by creator id
}

func newWorld(t *testing.T) *world {
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })
	w := &world{t: t, store: st, rooms: &fakeRooms{}, now: time.Now(), may: map[string]bool{}, mayErr: map[string]error{}}
	w.auth = auth.New(auth.Options{Provider: "gitlab", AllowedOrigins: []string{"http://127.0.0.1:5199"}, Log: zerolog.Nop()})
	w.start()
	return w
}

// start (again: a restart) makes the Guests of the world's store.
func (w *world) start() {
	if w.g != nil {
		w.g.Close()
	}
	g, err := New(Options{
		Store: w.store, Sessions: w.auth, Rooms: w.rooms, Log: zerolog.Nop(),
		MayShare: func(_ context.Context, user collab.User, _ string) (bool, error) {
			w.mu.Lock()
			defer w.mu.Unlock()
			if user.IsGuest() {
				return false, nil
			}
			if err := w.mayErr[user.ID]; err != nil {
				return false, err
			}
			may, ok := w.may[user.ID]
			return may || !ok, nil
		},
		now: func() time.Time { w.mu.Lock(); defer w.mu.Unlock(); return w.now },
	})
	require.NoError(w.t, err)
	w.g = g
	w.t.Cleanup(g.Close)
}

func (w *world) later(d time.Duration) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.now = w.now.Add(d)
}

// as sends a request signed in as identity (zero: signed out) to h, the {room} and {id} set.
func (w *world) as(identity auth.Identity, h http.HandlerFunc, method, roomName, id, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:1234/api/rooms/x/shares", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.SetPathValue("room", roomName)
	r.SetPathValue("id", id)
	if identity.Provider != "" {
		r = auth.WithIdentity(r, identity)
	}
	res := httptest.NewRecorder()
	h(res, r)
	return res
}

// create makes a share of room as ann: its view, the secret in Token.
func (w *world) create(roomName, label string, days int) shareView {
	res := w.as(ann, w.g.Create, http.MethodPost, roomName, "", jsonOf(map[string]any{"label": label, "days": days}))
	require.Equal(w.t, http.StatusCreated, res.Code, res.Body.String())
	var v shareView
	require.NoError(w.t, json.Unmarshal(res.Body.Bytes(), &v))
	return v
}

// join posts the join from ip; on success, the guest's identity (from the session cookie).
func (w *world) join(token, name, ip string, tweak ...func(*http.Request)) (*httptest.ResponseRecorder, auth.Identity) {
	r := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:1234/api/public/guest/join", strings.NewReader(jsonOf(map[string]string{"token": token, "name": name})))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://127.0.0.1:5199")
	r.RemoteAddr = ip + ":5555"
	for _, f := range tweak {
		f(r)
	}
	res := httptest.NewRecorder()
	w.g.Join(res, r)
	if res.Code != http.StatusNoContent {
		return res, auth.Identity{}
	}
	return res, w.identify(res)
}

// identify is who the session cookie res set is (zero: nobody).
func (w *world) identify(res *httptest.ResponseRecorder) auth.Identity {
	r := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:1234/api/me", nil)
	for _, c := range res.Result().Cookies() {
		r.AddCookie(c)
	}
	identity, _ := w.auth.Identify(r)
	return identity
}

func jsonOf(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func userOfIdentity(identity auth.Identity) collab.User { return userOf(identity) }

func TestAGuestJoinsAndOpensTheSharedRoomOnly(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME reviewers", 7)
	require.Len(t, share.Token, 26)
	require.Equal(t, "Ann", share.SharedBy)
	require.Equal(t, w.now.Add(7*24*time.Hour).UnixMilli(), share.ExpiresAt)

	res, guest := w.join(share.Token, "  Jane   Doe ", "10.0.0.1")
	require.Equal(t, http.StatusNoContent, res.Code, res.Body.String())
	require.Equal(t, collab.GuestProvider, guest.Provider)
	require.Equal(t, "Jane Doe (guest)", guest.Name)
	require.True(t, strings.HasPrefix(guest.Subject, share.ID+"/"))
	// names that would turn " (guest)" around, or put another email in a Co-authored-by trailer
	for _, spoof := range []string{"Ann\u202e", "\u2067Ann", "A\u0000nn", "Ann <ann@example.org>", "a>b"} {
		res, _ := w.join(share.Token, spoof, "10.0.0.3")
		require.Equal(t, http.StatusBadRequest, res.Code, "%q", spoof)
	}

	user := userOfIdentity(guest)
	require.NoError(t, w.g.Authorize(user, room))
	require.EqualError(t, w.g.Authorize(user, "gitlab:demo/report@other"), "This guest link is for another project.")
	require.EqualError(t, w.g.Authorize(user, "plain"), "This guest link is for another project.")

	// a guest sees their own share (no id) and may not share, nor revoke
	res = w.as(guest, w.g.List, http.MethodGet, room, "", "")
	require.Equal(t, http.StatusOK, res.Code)
	require.JSONEq(t, jsonOf(map[string]any{"shares": []any{map[string]any{
		"label": "ACME reviewers", "sharedBy": "Ann", "createdAt": share.CreatedAt, "expiresAt": share.ExpiresAt,
	}}}), res.Body.String())
	res = w.as(guest, w.g.List, http.MethodGet, "gitlab:demo/report@other", "", "")
	require.JSONEq(t, `{"shares":[]}`, res.Body.String())
	require.Equal(t, http.StatusForbidden, w.as(guest, w.g.Create, http.MethodPost, room, "", `{"label":"x"}`).Code)
	require.Equal(t, http.StatusForbidden, w.as(guest, w.g.Revoke, http.MethodDelete, room, share.ID, "").Code)
}

func TestMembersSeeWhoOfTheGuestsIsIn(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 1)
	_, jane := w.join(share.Token, "Jane", "10.0.0.1")
	w.g.PeerChanged(room, userOfIdentity(jane), true)
	w.g.PeerChanged(room, userOfIdentity(jane), true) // a second tab
	w.g.PeerChanged(room, collab.User{Provider: "gitlab", ID: "2", Name: "Bob"}, true)
	list := func() []shareView {
		res := w.as(ann, w.g.List, http.MethodGet, room, "", "")
		require.Equal(t, http.StatusOK, res.Code)
		var body struct{ Shares []shareView }
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		return body.Shares
	}
	require.Equal(t, []string{"Jane (guest)"}, list()[0].Online)
	require.Equal(t, share.ID, list()[0].ID)
	require.Empty(t, list()[0].Token, "the secret is answered once")
	w.g.PeerChanged(room, userOfIdentity(jane), false)
	require.Equal(t, []string{"Jane (guest)"}, list()[0].Online)
	w.g.PeerChanged(room, userOfIdentity(jane), false)
	require.Empty(t, list()[0].Online)
	require.Eventually(t, func() bool {
		w.rooms.mu.Lock()
		defer w.rooms.mu.Unlock()
		return len(w.rooms.broadcasts) == 5 // created, and four guest changes (Bob is no guest)
	}, time.Second, time.Millisecond)

	w.mu.Lock()
	w.may["1"] = false
	w.mu.Unlock()
	require.Equal(t, http.StatusForbidden, w.as(ann, w.g.List, http.MethodGet, room, "", "").Code, "only who may share")
}

func TestEveryFailedJoinGetsTheSame404(t *testing.T) {
	w := newWorld(t)
	expiring := w.create(room, "soon", 1)
	revoked := w.create(room, "revoked", 7)
	require.Equal(t, http.StatusNoContent, w.as(ann, w.g.Revoke, http.MethodDelete, room, revoked.ID, "").Code)
	w.later(24*time.Hour + time.Second)

	var answers []string
	for _, attempt := range []func() *httptest.ResponseRecorder{
		func() *httptest.ResponseRecorder { res, _ := w.join("NOSUCHTOKEN", "Jane", "10.0.0.1"); return res },
		func() *httptest.ResponseRecorder { res, _ := w.join(expiring.Token, "Jane", "10.0.0.1"); return res },
		func() *httptest.ResponseRecorder { res, _ := w.join(revoked.Token, "Jane", "10.0.0.1"); return res },
		func() *httptest.ResponseRecorder {
			res, _ := w.join(revoked.Token, "Jane", "10.0.0.1", func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") })
			return res
		},
		func() *httptest.ResponseRecorder {
			res, _ := w.join(revoked.Token, "Jane", "10.0.0.1", func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") })
			return res
		},
	} {
		res := attempt()
		require.Equal(t, http.StatusNotFound, res.Code)
		answers = append(answers, res.Body.String())
	}
	for _, a := range answers {
		require.Equal(t, answers[0], a)
	}
	res, _ := w.join("NOSUCHTOKEN", " ", "10.0.0.1")
	require.Equal(t, http.StatusBadRequest, res.Code, "a name is asked for before the link is looked at")
}

func TestExpiryAndRevocationEndTheGuestsAccess(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 1)
	res, jane := w.join(share.Token, "Jane", "10.0.0.1")
	other := w.create(room, "Others", 7)
	_, otto := w.join(other.Token, "Otto", "10.0.0.2")

	require.Equal(t, http.StatusNotFound, w.as(ann, w.g.Revoke, http.MethodDelete, "gitlab:demo/report@other", share.ID, "").Code, "not that room's")
	require.Equal(t, http.StatusNoContent, w.as(ann, w.g.Revoke, http.MethodDelete, room, share.ID, "").Code)
	require.Equal(t, auth.Identity{}, w.identify(res), "the session ended")
	require.EqualError(t, w.g.Authorize(userOfIdentity(jane), room), ReasonEnded)
	w.rooms.mu.Lock()
	require.Equal(t, []string{ReasonEnded}, w.rooms.disconnects, "their clients are refused (package app's tests: which)")
	w.rooms.mu.Unlock()
	require.NoError(t, w.g.Authorize(userOfIdentity(otto), room), "other shares' guests stay")

	// expiry
	w.later(7*24*time.Hour + time.Second)
	w.g.expire()
	require.EqualError(t, w.g.Authorize(userOfIdentity(otto), room), ReasonEnded)
	shares, err := w.store.Shares()
	require.NoError(t, err)
	require.Empty(t, shares, "ended shares are deleted")
}

// The expiry timer runs on the monotonic clock (it stalls while the machine sleeps): each sweep ends what
// expired by the wall clock, too.
func TestASweepEndsWhatExpired(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 1)
	_, jane := w.join(share.Token, "Jane", "10.0.0.1")
	w.later(24*time.Hour + time.Second)
	w.g.sweep()
	w.rooms.mu.Lock()
	require.Equal(t, []string{ReasonEnded}, w.rooms.disconnects)
	w.rooms.mu.Unlock()
	require.EqualError(t, w.g.Authorize(userOfIdentity(jane), room), ReasonEnded)
}

func TestOnlyTheSecretsHashIsStoredAndSharesSurviveARestart(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 30)
	shares, err := w.store.Shares()
	require.NoError(t, err)
	require.Len(t, shares, 1)
	hash := sha256.Sum256([]byte(share.Token))
	require.Equal(t, hash[:], shares[0].TokenHash)
	stored := jsonOf(shares[0])
	require.NotContains(t, stored, share.Token)

	w.start() // a restart: guest sessions are gone, the link still works
	res, guest := w.join(share.Token, "Jane", "10.0.0.1")
	require.Equal(t, http.StatusNoContent, res.Code)
	require.NoError(t, w.g.Authorize(userOfIdentity(guest), room))
}

func TestTheSQLiteFileHoldsNoSecret(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "rooms.db"))
	require.NoError(t, err)
	w := newWorld(t)
	w.store = st
	w.start()
	share := w.create(room, "ACME", 7)
	res, _ := w.join(share.Token, "Jane", "10.0.0.1")
	require.Equal(t, http.StatusNoContent, res.Code)
	w.g.Close()
	require.NoError(t, st.Close())

	var written []byte // the database and whatever journal SQLite left beside it
	files, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, f := range files {
		b, err := os.ReadFile(filepath.Join(dir, f.Name()))
		require.NoError(t, err)
		written = append(written, b...)
	}
	hash := sha256.Sum256([]byte(share.Token))
	require.True(t, bytes.Contains(written, hash[:]), "the hash is there: the file is read as written")
	require.False(t, bytes.Contains(written, []byte(share.Token)), "the secret is not")
	require.False(t, bytes.Contains(written, []byte(strings.ToLower(share.Token))), "in no case")
}

func TestSharesAreBounded(t *testing.T) {
	w := newWorld(t)
	for range MaxShares {
		w.create(room, "x", 1)
	}
	res := w.as(ann, w.g.Create, http.MethodPost, room, "", `{"label":"one more","days":1}`)
	require.Equal(t, http.StatusConflict, res.Code)
	w.create("gitlab:demo/report@other", "elsewhere", 7)
	require.Equal(t, http.StatusBadRequest, w.as(ann, w.g.Create, http.MethodPost, "r2", "", `{"label":"x","days":31}`).Code)
	require.Equal(t, http.StatusBadRequest, w.as(ann, w.g.Create, http.MethodPost, "r2", "", `{"label":"","days":7}`).Code)
	require.Equal(t, http.StatusBadRequest, w.as(ann, w.g.Create, http.MethodPost, "r2", "", `not json`).Code)
	v := w.create("r2", "default lifetime", 0)
	require.Equal(t, w.now.Add(DefaultDays*24*time.Hour).UnixMilli(), v.ExpiresAt)

	w.mu.Lock()
	w.may["1"] = false
	w.mu.Unlock()
	require.Equal(t, http.StatusForbidden, w.as(ann, w.g.Create, http.MethodPost, "r3", "", `{"label":"x"}`).Code)
}

func TestJoinsAreRateLimited(t *testing.T) {
	w := newWorld(t)
	for range joinsPerIP {
		res, _ := w.join("NOSUCHTOKEN", "Jane", "10.0.0.1")
		require.Equal(t, http.StatusNotFound, res.Code)
	}
	res, _ := w.join("NOSUCHTOKEN", "Jane", "10.0.0.1")
	require.Equal(t, http.StatusTooManyRequests, res.Code)
	res, _ = w.join("NOSUCHTOKEN", "Jane", "10.0.0.1", func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "10.9.9.9")
		r.Header.Set("X-Real-IP", "10.9.9.9")
	})
	require.Equal(t, http.StatusTooManyRequests, res.Code, "forwarding headers are not believed")
	res, _ = w.join("NOSUCHTOKEN", "Jane", "10.0.0.2")
	require.Equal(t, http.StatusNotFound, res.Code, "another address may")
	for i := range joinsInAll {
		w.join("NOSUCHTOKEN", "Jane", "10.1."+string(rune('0'+i/10))+"."+string(rune('0'+i%10)))
	}
	res, _ = w.join("NOSUCHTOKEN", "Jane", "10.0.0.3")
	require.Equal(t, http.StatusTooManyRequests, res.Code, "nor anyone, beyond the cap")
	w.later(time.Minute)
	res, _ = w.join("NOSUCHTOKEN", "Jane", "10.0.0.1")
	require.Equal(t, http.StatusNotFound, res.Code, "a minute later")
}

func TestACreatorWhoLostAccessLosesTheirShares(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 7)
	res, jane := w.join(share.Token, "Jane", "10.0.0.1")

	// signed out (cannot be asked): kept
	w.mu.Lock()
	w.mayErr["1"] = errors.New("signed out")
	w.mu.Unlock()
	w.g.sweep()
	require.NoError(t, w.g.Authorize(userOfIdentity(jane), room))
	res2, _ := w.join(share.Token, "Joe", "10.0.0.2")
	require.Equal(t, http.StatusNoContent, res2.Code, "a join, too")

	// GitLab says no
	w.mu.Lock()
	delete(w.mayErr, "1")
	w.may["1"] = false
	w.mu.Unlock()
	w.g.sweep()
	require.EqualError(t, w.g.Authorize(userOfIdentity(jane), room), ReasonEnded)
	require.Equal(t, auth.Identity{}, w.identify(res))
	res, _ = w.join(share.Token, "Jane", "10.0.0.1")
	require.Equal(t, http.StatusNotFound, res.Code)
}

func TestAJoinAsksAboutTheCreator(t *testing.T) {
	w := newWorld(t)
	share := w.create(room, "ACME", 7)
	w.mu.Lock()
	w.may["1"] = false
	w.mu.Unlock()
	res, _ := w.join(share.Token, "Jane", "10.0.0.1")
	require.Equal(t, http.StatusNotFound, res.Code)
	shares, err := w.store.Shares()
	require.NoError(t, err)
	require.Empty(t, shares, "the share ended")
}
