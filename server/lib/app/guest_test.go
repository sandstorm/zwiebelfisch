package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/guest"
)

const sharedRoom = "gitlab:demo/report@main"

func roomURL(room, rest string) string { return host + "/api/rooms/" + url.PathEscape(room) + rest }

// jsonRequest is a request with a JSON body from the demo's page.
func jsonRequest(method, target string, session *http.Cookie, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	if session != nil {
		req.AddCookie(session)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:5199")
	return req
}

// created is the share a Create answered.
func created(t *testing.T, res *http.Response) (id, token string) {
	t.Helper()
	body := text(t, res)
	require.Equal(t, http.StatusCreated, res.StatusCode, body)
	var share struct{ ID, Token string }
	require.NoError(t, json.Unmarshal([]byte(body), &share))
	return share.ID, share.Token
}

// joinAsGuest joins with the link's token under name and returns the guest's session cookie.
func joinAsGuest(t *testing.T, s *testServer, token, name string) *http.Cookie {
	t.Helper()
	res := get(t, s, jsonRequest("POST", host+"/api/public/guest/join", nil, `{"token":"`+token+`","name":"`+name+`"}`))
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	for _, c := range res.Cookies() {
		if c.Name == "zwf_session" {
			return c
		}
	}
	t.Fatal("no session cookie")
	return nil
}

func TestAGuestOpensTheSharedRoomOnly(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl, Guests: true})
	ann := signIn(t, fake, s, "Ann")

	id, token := created(t, get(t, s, jsonRequest("POST", roomURL(sharedRoom, "/shares"), ann, `{"label":"ACME","days":1}`)))
	jane := joinAsGuest(t, s, token, "Jane")

	me := text(t, get(t, s, request("GET", host+"/api/me", jane)))
	require.Contains(t, me, `"provider":"guest"`)
	require.Contains(t, me, `"name":"Jane (guest)"`)
	user, err := s.authenticate(s.identified(request("GET", host+"/api/collaboration", jane)), sharedRoom)
	require.NoError(t, err)
	require.True(t, user.IsGuest())
	_, err = s.authenticate(s.identified(request("GET", host+"/api/collaboration", jane)), "gitlab:demo/report@other")
	require.EqualError(t, err, "This guest link is for another project.")
	require.Equal(t, http.StatusUnauthorized, get(t, s, request("GET", roomURL("gitlab:demo/report@other", "/files/logo.png"), jane)).StatusCode,
		"another room's files")
	require.Equal(t, http.StatusForbidden, get(t, s, jsonRequest("POST", roomURL(sharedRoom, "/shares"), jane, `{"label":"mine"}`)).StatusCode)
	require.Equal(t, http.StatusForbidden, get(t, s, jsonRequest("DELETE", roomURL(sharedRoom, "/shares/"+id), jane, "")).StatusCode)

	// members who may not edit may not share
	fake.SetAccess("Rita", fakegitlab.Reporter)
	rita := signIn(t, fake, s, "Rita")
	require.Equal(t, http.StatusForbidden, get(t, s, jsonRequest("POST", roomURL(sharedRoom, "/shares"), rita, `{"label":"x"}`)).StatusCode)

	require.Equal(t, http.StatusNoContent, get(t, s, jsonRequest("DELETE", roomURL(sharedRoom, "/shares/"+id), ann, "")).StatusCode)
	require.Equal(t, http.StatusUnauthorized, get(t, s, request("GET", host+"/api/me", jane)).StatusCode, "revoked: the session ended")
}

func TestGuestLinksNeedTheSwitch(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl})
	ann := signIn(t, fake, s, "Ann")
	require.Equal(t, http.StatusNotFound, get(t, s, jsonRequest("POST", roomURL(sharedRoom, "/shares"), ann, `{"label":"x"}`)).StatusCode)
	require.Equal(t, http.StatusNotFound, get(t, s, jsonRequest("POST", host+"/api/public/guest/join", nil, `{"token":"x","name":"y"}`)).StatusCode)
}

// wsClient is a minimal Hocuspocus client over an in-memory transport: it opens rooms and records what
// their Auth answers say.
type wsClient struct {
	toServer, toClient chan []byte
	closed             chan struct{}
	once               sync.Once
	mu                 sync.Mutex
	answers            map[string][]string // by room: "authenticated", or the refusal's reason
}

func (c *wsClient) Read(ctx context.Context) ([]byte, error) {
	select {
	case msg := <-c.toServer:
		return msg, nil
	case <-c.closed:
		return nil, errors.New("closed")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *wsClient) Write(_ context.Context, msg []byte) error {
	select {
	case c.toClient <- msg:
		return nil
	case <-c.closed:
		return errors.New("closed")
	}
}

func (c *wsClient) Close(int, string) { c.once.Do(func() { close(c.closed) }) }

func lib0(s string) []byte { return append([]byte{byte(len(s))}, s...) } // short strings only

// connect opens a connection of the session's browser to s.
func connect(t *testing.T, s *testServer, session *http.Cookie) *wsClient {
	c := &wsClient{toServer: make(chan []byte, 64), toClient: make(chan []byte, 1024), closed: make(chan struct{}), answers: map[string][]string{}}
	upgrade := s.identified(request("GET", host+"/api/collaboration", session))
	served := make(chan struct{})
	go func() { defer close(served); s.rooms.Serve(context.Background(), c, upgrade) }()
	read := make(chan struct{})
	go func() {
		defer close(read)
		for {
			select {
			case msg := <-c.toClient:
				if len(msg) < 2 || int(msg[0])+3 > len(msg) || msg[1+msg[0]] != 2 { // not an Auth answer
					continue
				}
				room, payload := string(msg[1:1+msg[0]]), msg[2+msg[0]:]
				c.mu.Lock()
				if payload[0] == 2 {
					c.answers[room] = append(c.answers[room], "authenticated")
				} else {
					c.answers[room] = append(c.answers[room], string(payload[2:]))
				}
				c.mu.Unlock()
			case <-c.closed:
				return
			}
		}
	}()
	t.Cleanup(func() { c.Close(1000, ""); <-served; <-read })
	return c
}

func (c *wsClient) open(room string) {
	c.toServer <- append(append(lib0(room), 2, 0), lib0("")...)
}

func (c *wsClient) eventually(t *testing.T, room string, want ...string) {
	t.Helper()
	require.Eventually(t, func() bool {
		c.mu.Lock()
		defer c.mu.Unlock()
		return strings.Join(c.answers[room], "|") == strings.Join(want, "|")
	}, 5*time.Second, 2*time.Millisecond, "%s: %v", room, want)
}

func TestSignOutAndRevocationEndOpenConnections(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{PlainRooms: true, GitLab: gl, Guests: true})
	ann := signIn(t, fake, s, "Ann")
	annElsewhere := signIn(t, fake, s, "Ann") // another browser of hers
	bob := signIn(t, fake, s, "Bob")

	id, token := created(t, get(t, s, jsonRequest("POST", roomURL("plain", "/shares"), ann, `{"label":"ACME"}`)))
	jane := joinAsGuest(t, s, token, "Jane")

	annConn, elsewhere, bobConn, janeConn := connect(t, s, ann), connect(t, s, annElsewhere), connect(t, s, bob), connect(t, s, jane)
	for _, c := range []*wsClient{annConn, elsewhere, bobConn, janeConn} {
		c.open("plain")
		c.eventually(t, "plain", "authenticated")
	}
	janeConn.open("other")
	janeConn.eventually(t, "other", "This guest link is for another project.")

	require.Equal(t, http.StatusNoContent, get(t, s, request("POST", host+"/api/auth/logout", ann)).StatusCode)
	annConn.eventually(t, "plain", "authenticated", "You signed out.")
	annConn.open("plain")
	annConn.eventually(t, "plain", "authenticated", "You signed out.", "You signed out.") // the connection stays signed out
	elsewhere.eventually(t, "plain", "authenticated")
	bobConn.eventually(t, "plain", "authenticated")

	require.Equal(t, http.StatusNoContent, get(t, s, jsonRequest("DELETE", roomURL("plain", "/shares/"+id), bob, "")).StatusCode,
		"any member who may share revokes")
	janeConn.eventually(t, "plain", "authenticated", guest.ReasonEnded)
	bobConn.eventually(t, "plain", "authenticated")
}

// The widget's page on another port sends JSON and DELETEs with the cookie: the browser asks first.
func TestPreflightPermitsThisHostsPagesOnly(t *testing.T) {
	fake, gl := fakeGitLab()
	s := newServer(t, fake, Options{GitLab: gl, Guests: true})
	ask := func(origin, path string) *http.Response {
		req := httptest.NewRequest(http.MethodOptions, host+path, nil)
		req.Header.Set("Origin", origin)
		req.Header.Set("Access-Control-Request-Method", "POST")
		req.Header.Set("Access-Control-Request-Headers", "content-type")
		return get(t, s, req)
	}
	for _, path := range []string{"/api/public/guest/join", "/api/rooms/x/shares/y"} {
		res := ask("http://127.0.0.1:5199", path)
		require.Equal(t, http.StatusNoContent, res.StatusCode)
		require.Equal(t, "http://127.0.0.1:5199", res.Header.Get("Access-Control-Allow-Origin"))
		require.Equal(t, "true", res.Header.Get("Access-Control-Allow-Credentials"))
		require.Contains(t, res.Header.Get("Access-Control-Allow-Methods"), "DELETE")
		require.Equal(t, "Content-Type", res.Header.Get("Access-Control-Allow-Headers"))
	}
	res := ask("https://evil.example", "/api/public/guest/join")
	require.Empty(t, res.Header.Get("Access-Control-Allow-Origin"))
	require.Empty(t, res.Header.Get("Access-Control-Allow-Methods"))
}
