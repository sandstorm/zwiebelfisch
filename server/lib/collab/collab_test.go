package collab_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// The whole message flow in-process (the sandbox the tests run in cannot bind ports): clients are Go
// HocuspocusProvider stand-ins on a pipe, holding their own ydoc.Doc, each with the upgrade request a
// browser would send (a cookie "session" says who signed in). hocuspocus_test.go runs the real provider the
// same way.

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const (
	msgSync           = 0
	msgAwareness      = 1
	msgAuth           = 2
	msgQueryAwareness = 3
	msgStateless      = 5
	msgClose          = 7
	msgSyncStatus     = 8
	msgPing           = 9
	msgPong           = 10
)

func newServer(t *testing.T, st collab.Store, opts ...func(*collab.Options)) *collab.Server {
	o := collab.Options{Store: st, Authenticate: signedIn, Debounce: 20 * time.Millisecond, Log: zerolog.Nop()}
	for _, f := range opts {
		f(&o)
	}
	s := collab.New(o)
	t.Cleanup(func() { require.NoError(t, s.Close(context.Background())) })
	return s
}

// signedIn lets in whoever has a session (the stand-in for package auth), as nobody in particular.
func signedIn(r *http.Request, _ string) (collab.User, error) {
	if session(r) == "" {
		return collab.User{}, errors.New("not signed in")
	}
	return collab.User{}, nil
}

func session(r *http.Request) string {
	c, err := r.Cookie("session")
	if err != nil {
		return ""
	}
	return c.Value
}

func memStore(t *testing.T) *store.Store {
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	t.Cleanup(func() { st.Close() })
	return st
}

// pipe is an in-memory Transport: the server's end; the test client holds the other.
type pipe struct {
	toServer, toClient chan []byte
	closed             chan struct{}
	once               sync.Once
	code               int
}

func newPipe() *pipe {
	return &pipe{toServer: make(chan []byte, 64), toClient: make(chan []byte, 1024), closed: make(chan struct{})}
}

func (p *pipe) Read(ctx context.Context) ([]byte, error) {
	select {
	case msg := <-p.toServer:
		return msg, nil
	case <-p.closed:
		return nil, errors.New("closed")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (p *pipe) Write(ctx context.Context, msg []byte) error {
	select {
	case p.toClient <- msg:
		return nil
	case <-p.closed:
		return errors.New("closed")
	}
}

func (p *pipe) Close(code int, _ string) {
	p.once.Do(func() { p.code = code; close(p.closed) })
}

// client is a minimal HocuspocusProvider: Auth, then sync, then relays its document's changes.
type client struct {
	t       *testing.T
	address string
	p       *pipe
	done    chan struct{}

	mu        sync.Mutex
	doc       *ydoc.Doc
	auth      []string // "authenticated" / "denied"
	reasons   []string // of the denials
	acks      int
	awareness [][]byte
	stateless []string
	foreign   []byte   // types of messages to other addresses
	hold      bool     // keep the document's changes in held instead of sending them
	held      [][]byte // sync messages
}

type serverOrigin struct{ _ byte }

var fromServer = &serverOrigin{}

// dial connects as the session's user ("": signed out) and opens the room at address.
func dial(t *testing.T, s *collab.Server, address, session string) *client {
	c := connect(t, s, address, session)
	c.authenticate()
	return c
}

// connect opens a connection without sending anything yet.
func connect(t *testing.T, s *collab.Server, address, session string) *client {
	return connectWith(t, s, address, session, ydoc.New())
}

// connectWith is connect for a client that continues with doc (a provider that reconnects keeps its Y.Doc).
func connectWith(t *testing.T, s *collab.Server, address, session string, doc *ydoc.Doc) *client {
	c := &client{t: t, address: address, p: newPipe(), done: make(chan struct{}), doc: doc}
	upgrade := httptest.NewRequest(http.MethodGet, "/", nil)
	if session != "" {
		upgrade.AddCookie(&http.Cookie{Name: "session", Value: session})
	}
	served := make(chan struct{})
	go func() { defer close(served); s.Serve(context.Background(), c.p, upgrade) }()
	go c.read()
	stop := c.doc.OnUpdate(func(update []byte, origin any) {
		switch {
		case origin == fromServer:
		case c.hold:
			c.held = append(c.held, ydoc.SyncUpdate(update))
		default:
			c.send(msgSync, ydoc.SyncUpdate(update))
		}
	})
	t.Cleanup(stop)
	t.Cleanup(func() { c.close(); <-served; <-c.done })
	return c
}

// authenticate sends the provider's Auth message (its token is empty: the widget sends none), then SyncStep1.
func (c *client) authenticate() {
	c.send(msgAuth, append([]byte{0}, lib0String("")...))
	c.send(msgSync, c.doc.SyncStep1())
}

func lib0String(s string) []byte {
	var n []byte
	for l := len(s); ; l >>= 7 {
		if l < 0x80 {
			n = append(n, byte(l))
			break
		}
		n = append(n, byte(l)|0x80)
	}
	return append(n, s...)
}

func (c *client) send(typ byte, payload []byte) {
	msg := append(append(lib0String(c.address), typ), payload...)
	select {
	case c.p.toServer <- msg:
	case <-c.p.closed:
	}
}

func (c *client) close() { c.p.Close(1000, "") }

func (c *client) read() {
	defer close(c.done)
	for {
		select {
		case msg := <-c.p.toClient:
			c.handle(msg)
		case <-c.p.closed:
			return
		}
	}
}

func (c *client) handle(msg []byte) {
	if len(msg) == 1 && msg[0] == msgPing { // the provider answers at once
		go func() {
			select {
			case c.p.toServer <- []byte{msgPong}:
			case <-c.p.closed:
			}
		}()
		return
	}
	n, at := 0, 0
	for shift := 0; ; shift += 7 {
		n |= int(msg[at]&0x7f) << shift
		at++
		if msg[at-1] < 0x80 {
			break
		}
	}
	address, typ, payload := string(msg[at:at+n]), msg[at+n], msg[at+n+1:]
	c.mu.Lock()
	defer c.mu.Unlock()
	if address != c.address { // another room on the same connection
		c.foreign = append(c.foreign, typ)
		return
	}
	switch typ {
	case msgSync:
		reply, isStep1, err := c.doc.HandleSync(payload, fromServer)
		require.NoError(c.t, err)
		if isStep1 {
			go c.send(msgSync, reply)
		}
	case msgAuth:
		c.auth = append(c.auth, map[byte]string{1: "denied", 2: "authenticated"}[payload[0]])
		if payload[0] == 1 {
			c.reasons = append(c.reasons, string(payload[2:])) // VarString; reasons here are < 128 bytes
		}
	case msgSyncStatus:
		c.acks++
	case msgAwareness:
		c.awareness = append(c.awareness, payload[1:]) // VarBytes; updates here are < 128 bytes
	case msgStateless:
		c.stateless = append(c.stateless, string(payload[1:]))
	}
}

func (c *client) edit(fn func(w *ydoc.Writer)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	require.NoError(c.t, c.doc.Write(nil, fn))
}

func (c *client) texts() map[string]string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.doc.Texts("files")
}

func (c *client) eventually(what string, ok func() bool) {
	c.t.Helper()
	require.Eventually(c.t, func() bool { c.mu.Lock(); defer c.mu.Unlock(); return ok() }, 5*time.Second, 2*time.Millisecond, what)
}

func awarenessUpdate(clientID, clock byte, state string) []byte {
	return append([]byte{1, clientID, clock}, lib0String(state)...)
}

func TestTwoClientsEditTogether(t *testing.T) {
	s := newServer(t, memStore(t))
	a := dial(t, s, "report", "secret")
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "Hello 😀") })
	b := dial(t, s, "report", "secret")
	b.eventually("b gets what a wrote before it came", func() bool { return b.doc.Texts("files")["/main.typ"] == "Hello 😀" })

	b.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 8, 8, " and B") })
	a.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "» ") })
	want := map[string]string{"/main.typ": "» Hello 😀 and B"}
	a.eventually("a converges", func() bool { return a.doc.Texts("files")["/main.typ"] == want["/main.typ"] })
	b.eventually("b converges", func() bool { return b.doc.Texts("files")["/main.typ"] == want["/main.typ"] })
	a.eventually("every update a sent is acknowledged (provider's hasUnsyncedChanges)", func() bool { return a.acks >= 3 })
	require.Equal(t, []string{"authenticated"}, a.auth)

	// presence: relayed to everyone; when a goes, b learns that a's client left
	a.send(msgAwareness, append([]byte{byte(len(awarenessUpdate(7, 1, `{"user":"a"}`)))}, awarenessUpdate(7, 1, `{"user":"a"}`)...))
	b.eventually("b sees a's presence", func() bool { return len(b.awareness) == 1 })
	a.eventually("a gets its own back (keeps its connection alive)", func() bool { return len(a.awareness) == 1 })
	a.close()
	b.eventually("b sees a leave", func() bool {
		return len(b.awareness) == 2 && string(b.awareness[1]) == string(awarenessUpdate(7, 1, "null"))
	})
}

func TestNewClientGetsPresenceAndCanQueryIt(t *testing.T) {
	s := newServer(t, memStore(t))
	a := dial(t, s, "r", "secret")
	update := awarenessUpdate(9, 1, `{"cursor":3}`)
	a.send(msgAwareness, append([]byte{byte(len(update))}, update...))
	a.eventually("echo", func() bool { return len(a.awareness) == 1 })
	b := dial(t, s, "r", "secret")
	b.eventually("b gets the room's presence on joining", func() bool { return len(b.awareness) == 1 })
	b.send(msgQueryAwareness, nil)
	b.eventually("and on asking", func() bool { return len(b.awareness) == 2 && string(b.awareness[1]) == string(update) })
}

func TestStoresDebouncedAndWhenTheLastClientLeaves(t *testing.T) {
	st := memStore(t)
	s := newServer(t, st)
	a := dial(t, s, "book", "secret")
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/ch1.typ", "One") })
	require.Eventually(t, func() bool { return storedText(t, st, "book") == "One" }, 5*time.Second, 5*time.Millisecond, "stored after the debounce, while a is still there")

	a.edit(func(w *ydoc.Writer) { w.Edit("files", "/ch1.typ", 3, 3, " two") })
	a.eventually("acknowledged", func() bool { return a.acks >= 2 })
	a.close()
	require.Eventually(t, func() bool { return storedText(t, st, "book") == "One two" }, 5*time.Second, 5*time.Millisecond)

	// a new server (a restart) loads it
	s2 := newServer(t, st)
	c := dial(t, s2, "book", "secret")
	c.eventually("loaded", func() bool { return c.doc.Texts("files")["/ch1.typ"] == "One two" })
}

func TestCloseStoresOpenRooms(t *testing.T) {
	st := memStore(t)
	s := collab.New(collab.Options{Store: st, Authenticate: signedIn, Debounce: time.Hour, Log: zerolog.Nop()})
	a := dial(t, s, "open", "ann")
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/x", "unsaved") })
	a.eventually("acknowledged", func() bool { return a.acks >= 1 })
	require.NoError(t, s.Close(context.Background()))
	require.Equal(t, "unsaved", storedText(t, st, "open"))
	b := connect(t, s, "open", "ann")
	<-b.done // refused: closed
}

func storedText(t *testing.T, st *store.Store, room string) string {
	state, err := st.Load(room)
	require.NoError(t, err)
	if state == nil {
		return ""
	}
	d, err := ydoc.Load(state)
	require.NoError(t, err)
	for _, text := range d.Texts("files") {
		return text
	}
	return ""
}

func TestRefusedClientGetsNothingAndMayTryAgain(t *testing.T) {
	var admitted atomic.Bool // later: say, the room's owner gave the newcomer access
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) {
			if session(r) == "newcomer" && !admitted.Load() {
				return collab.User{}, errors.New("no access")
			}
			return collab.User{}, nil
		}
	})
	a := dial(t, s, "secret-room", "ann")
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/x", "confidential") })

	newcomer := dial(t, s, "secret-room", "newcomer")
	newcomer.eventually("denied", func() bool { return len(newcomer.auth) == 1 && newcomer.auth[0] == "denied" })
	time.Sleep(50 * time.Millisecond) // anything the server would (wrongly) send comes by now
	require.Empty(t, newcomer.texts(), "the SyncStep1 sent before the refusal was dropped, not answered")

	// the provider may try again on the same connection (the check runs again, on the same request)
	admitted.Store(true)
	newcomer.authenticate()
	newcomer.eventually("in now", func() bool { return newcomer.doc.Texts("files")["/x"] == "confidential" })
}

func TestSignedOutIsRefused(t *testing.T) {
	c := dial(t, newServer(t, memStore(t)), "room", "")
	c.eventually("refused", func() bool { return len(c.reasons) == 1 })
	require.Equal(t, "permission-denied", c.reasons[0])
}

func TestRefusalTellsItsReason(t *testing.T) {
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(*http.Request, string) (collab.User, error) {
			return collab.User{}, collab.Refusal{Reason: "no plain rooms here"}
		}
	})
	c := dial(t, s, "room", "ann")
	c.eventually("refused", func() bool { return len(c.reasons) == 1 })
	require.Equal(t, "no plain rooms here", c.reasons[0])

	other := dial(t, newServer(t, memStore(t)), "room", "")
	other.eventually("refused", func() bool { return len(other.reasons) == 1 })
	require.Equal(t, "permission-denied", other.reasons[0], "other errors are not told")
}

func TestAGuestsUpdateThatWaitsForChangesToComeIsRefused(t *testing.T) {
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) {
			if session(r) == "guest" {
				return collab.User{Provider: collab.GuestProvider, ID: "share1/abc", Name: "Jane (guest)"}, nil
			}
			return signedIn(r, "")
		}
	})
	a := dial(t, s, "report", "secret")
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "Hello") })
	g := dial(t, s, "report", "guest")
	g.eventually("the guest has the room", func() bool { return g.doc.Texts("files")["/main.typ"] == "Hello" })

	// the second of two changes, without the first: it would wait for the first, and take effect with whoever sends it
	g.mu.Lock()
	other, err := ydoc.Load(g.doc.State())
	g.mu.Unlock()
	require.NoError(t, err)
	require.NoError(t, other.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "1 ") }))
	var second []byte
	other.OnUpdate(func(u []byte, _ any) { second = u })
	require.NoError(t, other.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "2 ") }))
	g.send(msgSync, ydoc.SyncUpdate(second))
	g.eventually("refused", func() bool { return len(g.reasons) == 1 })
	require.Equal(t, "Your change depends on changes this project does not have; open the project again.", g.reasons[0])

	a.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 5, 5, "!") })
	b := dial(t, s, "report", "secret")
	b.eventually("the room has the member's edit and nothing of the guest's", func() bool { return b.doc.Texts("files")["/main.typ"] == "Hello!" })
}

// extension is an Extension for tests: it opens every room whose name starts with "x-", records what it
// is told and lets the test decide when Left returns.
type extension struct {
	stateless chan got
	opened    chan *collab.Room
	left      chan chan struct{} // per Left call: closed by the test to let it return
	closed    chan string
	by, last  chan collab.User // who opened a room, who left it last
}

type got struct {
	room, payload, name string
	user                collab.User
}

func newExtension() *extension {
	return &extension{stateless: make(chan got, 8), opened: make(chan *collab.Room, 8), left: make(chan chan struct{}, 8), closed: make(chan string, 8),
		by: make(chan collab.User, 8), last: make(chan collab.User, 8)}
}

func (x *extension) Open(r *collab.Room, doc *ydoc.Doc, by collab.User) (collab.Handler, error) {
	x.by <- by
	if r.Name() == "x-broken" {
		return nil, errors.New("cannot open")
	}
	if r.Name()[:2] != "x-" {
		return nil, nil
	}
	if err := doc.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/opened.typ", "by the extension") }); err != nil {
		return nil, err
	}
	x.opened <- r
	return &handler{x, r}, nil
}

type handler struct {
	x *extension
	r *collab.Room
}

func (h *handler) Stateless(p *collab.Peer, payload string) {
	h.x.stateless <- got{p.Room(), payload, p.Name(), p.User()}
	p.SendStateless("saved")
	go h.r.BroadcastStateless("to all")
}

func (h *handler) Left(ctx context.Context, last collab.User) {
	h.x.last <- last
	release := make(chan struct{})
	h.x.left <- release
	select {
	case <-release:
	case <-ctx.Done():
	}
}

func (h *handler) Close() { h.x.closed <- h.r.Name() }

func TestStatelessReachesTheExtensionAndRepliesToOneClient(t *testing.T) {
	x := newExtension()
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) { return collab.User{Name: session(r)}, nil }
		o.Extension = x
	})
	a := dial(t, s, "x-r", "alice")
	b := dial(t, s, "x-r", "bob")
	a.eventually("the extension wrote into the room before anyone joined", func() bool { return a.doc.Texts("files")["/opened.typ"] == "by the extension" })
	a.send(msgStateless, lib0String("gitlab:save"))
	require.Equal(t, got{"x-r", "gitlab:save", "alice", collab.User{Name: "alice"}}, <-x.stateless)
	a.eventually("the reply goes to a", func() bool { return len(a.stateless) == 2 && a.stateless[0] == "saved" })
	b.eventually("and the broadcast to everyone", func() bool { return len(b.stateless) == 1 && b.stateless[0] == "to all" })
}

func TestPeerIsNamedByItsAwarenessWithoutAUser(t *testing.T) {
	x := newExtension()
	s := newServer(t, memStore(t), func(o *collab.Options) { o.Extension = x })
	a := dial(t, s, "x-names", "secret")
	update := awarenessUpdate(7, 1, `{"user":{"name":" Cleo ","color":"#fff"}}`)
	a.send(msgAwareness, append([]byte{byte(len(update))}, update...))
	a.eventually("echo", func() bool { return len(a.awareness) == 1 })
	a.send(msgStateless, lib0String("hi"))
	require.Equal(t, "Cleo", (<-x.stateless).name)
}

func TestExtensionKeepsTheRoomUntilLeftReturns(t *testing.T) {
	st := memStore(t)
	x := newExtension()
	s := newServer(t, st, func(o *collab.Options) { o.Extension = x })
	a := dial(t, s, "x-keep", "secret")
	room := <-x.opened
	a.close()
	release := <-x.left
	require.True(t, room.Empty())
	require.True(t, room.Do(func(doc *ydoc.Doc) {
		require.NoError(t, doc.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/late.typ", "after everyone left") }))
	}), "still loaded")

	// someone comes back meanwhile: the room stays when Left returns
	b := dial(t, s, "x-keep", "secret")
	b.eventually("same room", func() bool { return b.doc.Texts("files")["/late.typ"] == "after everyone left" })
	close(release)
	require.False(t, room.Empty())
	b.close()
	close(<-x.left)
	require.Equal(t, "x-keep", <-x.closed)
	require.False(t, room.Do(func(*ydoc.Doc) {}), "unloaded")
	require.Equal(t, "after everyone left", storedTexts(t, st, "x-keep")["/late.typ"], "stored before unloading")

	// a plain room next to it: the extension left it alone
	c := dial(t, s, "plain", "secret")
	c.edit(func(w *ydoc.Writer) { w.SetText("files", "/p", "plain") })
	c.eventually("acknowledged", func() bool { return c.acks >= 1 })
	require.Empty(t, x.opened)
}

func TestExtensionLearnsWhoOpenedWhoIsInAndWhoLeftLast(t *testing.T) {
	x := newExtension()
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) { return collab.User{ID: session(r)}, nil }
		o.Extension = x
	})
	a := dial(t, s, "x-who", "ann")
	room := <-x.opened
	require.Equal(t, collab.User{ID: "ann"}, <-x.by)
	b := dial(t, s, "x-who", "bob")
	b.eventually("joined", func() bool { return len(room.Users()) == 2 })
	require.ElementsMatch(t, []collab.User{{ID: "ann"}, {ID: "bob"}}, room.Users())
	a.close()
	require.Eventually(t, func() bool { return len(room.Users()) == 1 }, 5*time.Second, time.Millisecond)
	b.close()
	close(<-x.left)
	require.Equal(t, collab.User{ID: "bob"}, <-x.last)
	require.Equal(t, "x-who", <-x.closed)
	require.Empty(t, room.Users(), "unloaded")
}

func TestCloseEndsWhatTheExtensionWaitsFor(t *testing.T) {
	x := newExtension()
	s := collab.New(collab.Options{Store: memStore(t), Authenticate: signedIn, Extension: x, Log: zerolog.Nop()})
	a := dial(t, s, "x-closing", "ann")
	<-x.opened
	a.close()
	<-x.left // never released: Close ends it
	require.NoError(t, s.Close(context.Background()))
	require.Equal(t, "x-closing", <-x.closed)
}

func TestExtensionErrorRefusesTheClients(t *testing.T) {
	s := newServer(t, memStore(t), func(o *collab.Options) { o.Extension = newExtension() })
	a := dial(t, s, "x-broken", "secret")
	<-a.done
	require.Equal(t, 4205, a.p.code)
}

func storedTexts(t *testing.T, st *store.Store, room string) map[string]string {
	state, err := st.Load(room)
	require.NoError(t, err)
	d, err := ydoc.Load(state)
	require.NoError(t, err)
	return d.Texts("files")
}

func TestOneConnectionManyRoomsAndSessionAddresses(t *testing.T) {
	s := newServer(t, memStore(t))
	a := dial(t, s, "one\x00session-a", "secret") // a provider with sessionAwareness
	a.edit(func(w *ydoc.Writer) { w.SetText("files", "/x", "in one") })
	b := dial(t, s, "one", "secret")
	b.eventually("same room", func() bool { return b.doc.Texts("files")["/x"] == "in one" })

	// a second room on b's connection
	other := &client{t: t, address: "two", p: b.p, done: make(chan struct{}), doc: ydoc.New()}
	other.authenticate()
	b.eventually("room two answers on b's connection: Authenticated, SyncStep1, SyncStep2", func() bool {
		return string(b.foreign) == string([]byte{msgAuth, msgSync, msgSync})
	})
	require.Equal(t, []string{"authenticated"}, b.auth, "room one's provider saw nothing of it")
	b.send(msgClose, nil) // the provider of room one detaches; the connection stays
	b.close()
}

func TestBadMessageClosesTheConnection(t *testing.T) {
	s := newServer(t, memStore(t))
	a := dial(t, s, "r", "secret")
	a.eventually("synced", func() bool { return a.acks >= 1 })
	a.send(msgSync, []byte{9, 9, 9})
	<-a.done
	require.Equal(t, 4205, a.p.code)
}

func TestOneConnectionOpensAtMost16Rooms(t *testing.T) {
	s := newServer(t, memStore(t))
	c := connect(t, s, "seventeenth", "secret")
	for i := range 16 {
		other := &client{t: t, address: fmt.Sprintf("room-%d", i), p: c.p, done: make(chan struct{}), doc: ydoc.New()}
		other.authenticate()
	}
	c.eventually("16 rooms open", func() bool { return bytes.Count(c.foreign, []byte{msgAuth}) == 16 })
	c.authenticate()
	c.eventually("refused", func() bool { return len(c.reasons) == 1 })
	require.Equal(t, "This connection has 16 rooms open, the most it may; close one first.", c.reasons[0])

	(&client{address: "room-0", p: c.p}).send(msgClose, nil)
	c.authenticate()
	c.eventually("room-0 closed: in now", func() bool { return len(c.auth) == 2 && c.auth[1] == "authenticated" })
}

func TestLongRoomNameIsRefused(t *testing.T) {
	var asked atomic.Bool
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(*http.Request, string) (collab.User, error) { asked.Store(true); return collab.User{}, nil }
	})
	c := dial(t, s, strings.Repeat("x", 1025), "secret")
	c.eventually("refused", func() bool { return len(c.reasons) == 1 })
	require.Equal(t, "A room name has at most 1024 bytes.", c.reasons[0])
	require.False(t, asked.Load(), "not even asked")
}

func TestSilentClientIsDropped(t *testing.T) {
	s := newServer(t, memStore(t), func(o *collab.Options) { o.PingInterval = 10 * time.Millisecond })
	answering := dial(t, s, "r", "secret") // answers every ping, as the provider does
	silent := newPipe()                    // sends nothing, answers nothing
	served := make(chan struct{})
	go func() {
		defer close(served)
		s.Serve(context.Background(), silent, httptest.NewRequest(http.MethodGet, "/", nil))
	}()
	select {
	case <-served:
	case <-time.After(5 * time.Second):
		t.Fatal("the silent client is still connected")
	}
	require.Equal(t, []byte{msgPing}, <-silent.toClient, "it was pinged")
	select {
	case <-answering.done:
		t.Fatal("the answering client was dropped")
	default:
	}
	answering.edit(func(w *ydoc.Writer) { w.SetText("files", "/x", "still here") })
	answering.eventually("its edit applied", func() bool { return answering.acks >= 2 })
}

func TestDisconnectRefusesTheMatchedClientsWithTheReason(t *testing.T) {
	var admitted atomic.Bool
	admitted.Store(true)
	var changes []string
	var changesMu sync.Mutex
	s := newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) {
			if session(r) == "guest" && !admitted.Load() {
				return collab.User{}, collab.Refusal{Reason: "gone"}
			}
			return collab.User{ID: session(r), Name: session(r)}, nil
		}
		o.PeerChanged = func(room string, user collab.User, joined bool) {
			changesMu.Lock()
			defer changesMu.Unlock()
			changes = append(changes, fmt.Sprintf("%s %s %v", room, user.ID, joined))
		}
	})
	ann := dial(t, s, "report", "ann")
	guest := dial(t, s, "report", "guest")
	ann.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "Hello") })
	guest.eventually("synced", func() bool { return guest.doc.Texts("files")["/main.typ"] == "Hello" })

	admitted.Store(false)
	s.Disconnect(func(p *collab.Peer) bool {
		require.NotNil(t, p.Request())
		return p.User().ID == "guest"
	}, "Guest access to this project has ended.")
	guest.eventually("refused with the reason", func() bool {
		return len(guest.reasons) == 1 && guest.reasons[0] == "Guest access to this project has ended."
	})

	// what the dropped client still sends reaches nobody; what others write no longer reaches it
	guest.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "Hello from outside") })
	ann.edit(func(w *ydoc.Writer) { w.SetText("files", "/other.typ", "later") })
	ann.eventually("ann's own edit is there", func() bool { return ann.doc.Texts("files")["/other.typ"] == "later" })
	time.Sleep(50 * time.Millisecond)
	require.Equal(t, "Hello", ann.texts()["/main.typ"])
	require.NotContains(t, guest.texts(), "/other.typ")

	// opening the room again asks Authenticate again
	guest.authenticate()
	guest.eventually("refused again", func() bool { return len(guest.reasons) == 2 && guest.reasons[1] == "gone" })
	require.Equal(t, []string{"authenticated"}, ann.auth, "ann stays")

	changesMu.Lock()
	defer changesMu.Unlock()
	require.ElementsMatch(t, []string{"report ann true", "report guest true", "report guest false"}, changes)
	require.Equal(t, "report guest false", changes[2])
}

func TestBroadcastStatelessReachesALoadedRoomOnly(t *testing.T) {
	s := newServer(t, memStore(t))
	a := dial(t, s, "report", "ann")
	a.eventually("in", func() bool { return len(a.auth) == 1 })
	s.BroadcastStateless("report", `{"type":"guests:changed"}`)
	s.BroadcastStateless("elsewhere", "nobody")
	a.eventually("told", func() bool { return len(a.stateless) == 1 && a.stateless[0] == `{"type":"guests:changed"}` })
}

func TestDisconnectWhileAClientIsLetInRefusesItToo(t *testing.T) {
	var admitted atomic.Bool
	admitted.Store(true)
	var s *collab.Server
	s = newServer(t, memStore(t), func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) {
			if session(r) != "guest" {
				return collab.User{ID: session(r), Name: session(r)}, nil
			}
			if !admitted.Load() {
				return collab.User{}, collab.Refusal{Reason: "gone"}
			}
			// let in, but revoked before the client is in the room: Disconnect finds nobody to refuse yet
			admitted.Store(false)
			s.Disconnect(func(p *collab.Peer) bool { return p.User().ID == "guest" }, "gone")
			return collab.User{ID: "guest", Name: "guest"}, nil
		}
	})
	ann := dial(t, s, "report", "ann")
	ann.eventually("in", func() bool { return len(ann.auth) == 1 })
	guest := dial(t, s, "report", "guest")
	guest.eventually("refused after all", func() bool {
		return len(guest.reasons) == 1 && guest.reasons[0] == "gone"
	})
	ann.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "after") })
	ann.eventually("ann's edit is there", func() bool { return ann.doc.Texts("files")["/main.typ"] == "after" })
	time.Sleep(50 * time.Millisecond)
	require.NotContains(t, guest.texts(), "/main.typ")
}

func TestWebSocketsOnlyFromAllowedPages(t *testing.T) {
	allowed := func(r *http.Request) bool { return r.Header.Get("Origin") == "https://editor.example.org" }
	for _, c := range []struct {
		allowedOrigin func(*http.Request) bool
		host, origin  string
		refused       bool
	}{
		{allowed, "zwf.example.org", "https://editor.example.org", false},
		{allowed, "zwf.example.org", "https://evil.example", true},
		{allowed, "evil.example", "https://evil.example", true}, // websocket.Accept alone lets in its Host's pages
		{nil, "zwf.example.org", "https://editor.example.org", true},
		{nil, "zwf.example.org", "", true}, // nil: no WebSocket at all
	} {
		s := newServer(t, memStore(t), func(o *collab.Options) { o.AllowedOrigin = c.allowedOrigin })
		upgrade := httptest.NewRequest(http.MethodGet, "http://"+c.host+"/", nil)
		upgrade.Header.Set("Connection", "Upgrade")
		upgrade.Header.Set("Upgrade", "websocket")
		upgrade.Header.Set("Sec-WebSocket-Version", "13")
		upgrade.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		if c.origin != "" {
			upgrade.Header.Set("Origin", c.origin)
		}
		res := httptest.NewRecorder()
		s.ServeHTTP(res, upgrade)
		require.Equal(t, c.refused, res.Code == http.StatusForbidden, "%s from %q", c.host, c.origin)
	}
}

// users lets in "guest…" sessions as guests and the others as members, each as the user its session names;
// left counts the clients that left a room.
func users(left *atomic.Int32) func(*collab.Options) {
	return func(o *collab.Options) {
		o.Authenticate = func(r *http.Request, _ string) (collab.User, error) {
			if strings.HasPrefix(session(r), "guest") {
				return collab.User{Provider: collab.GuestProvider, ID: "share1/" + session(r), Name: session(r)}, nil
			}
			return collab.User{Provider: "test", ID: session(r), Name: session(r)}, nil
		}
		o.PeerChanged = func(_ string, _ collab.User, joined bool) {
			if !joined {
				left.Add(1)
			}
		}
	}
}

const notYours = "Your change was made in an editing session that is not yours in this project; open the project again."

// heldEdit makes an edit in c's document without sending it, and returns its sync message.
func (c *client) heldEdit(fn func(w *ydoc.Writer)) []byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.hold = true
	defer func() { c.hold, c.held = false, nil }()
	require.NoError(c.t, c.doc.Write(nil, fn))
	return c.held[0]
}

func TestAnUpdateUnderAnotherUsersClientIDIsRefused(t *testing.T) {
	var left atomic.Int32
	s := newServer(t, memStore(t), users(&left))
	alice := dial(t, s, "report", "alice")
	alice.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "Hello") })
	bob := dial(t, s, "report", "bob")
	guest := dial(t, s, "report", "guest")
	guest.eventually("synced", func() bool { return guest.doc.Texts("files")["/main.typ"] == "Hello" })

	// items under alice's client id at her current clock, from bob or the guest: refused, nothing applied
	next := alice.heldEdit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 5, 5, "!") })
	for _, c := range []*client{bob, guest} {
		c.send(msgSync, next)
		c.eventually("refused", func() bool { return len(c.reasons) == 1 })
		require.Equal(t, notYours, c.reasons[0])
	}

	// alice's own change at that clock, and her later ones, take effect
	alice.send(msgSync, next)
	alice.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "» ") })
	carol := dial(t, s, "report", "carol")
	carol.eventually("the room has alice's edits", func() bool { return carol.doc.Texts("files")["/main.typ"] == "» Hello!" })
	require.Equal(t, []string{"authenticated"}, alice.auth)
}

func TestAClientContinuesWithItsClientIDAfterAReconnect(t *testing.T) {
	var left atomic.Int32
	s := newServer(t, memStore(t), users(&left))
	alice := dial(t, s, "report", "alice")
	alice.edit(func(w *ydoc.Writer) { w.SetText("files", "/main.typ", "a") })
	guest := dial(t, s, "report", "guest")
	guest.eventually("synced", func() bool { return guest.doc.Texts("files")["/main.typ"] == "a" })
	guest.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 1, 1, "g") })
	bob := dial(t, s, "report", "bob") // keeps the room loaded
	bob.eventually("synced", func() bool { return bob.doc.Texts("files")["/main.typ"] == "ag" })

	// in a loaded room: both reconnect with their documents and go on
	alice.close()
	guest.close()
	require.Eventually(t, func() bool { return left.Load() == 2 }, 5*time.Second, 2*time.Millisecond)
	alice = connectWith(t, s, "report", "alice", alice.doc)
	alice.authenticate()
	guest = connectWith(t, s, "report", "guest", guest.doc)
	guest.authenticate()
	alice.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "A") })
	guest.eventually("synced", func() bool { return guest.doc.Texts("files")["/main.typ"] == "Aag" })
	guest.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 3, 3, "G") })
	bob.eventually("bob gets both", func() bool { return bob.doc.Texts("files")["/main.typ"] == "AagG" })

	// after the room reloaded: alice (a member) goes on with her client id, the guest may not
	alice.close()
	guest.close()
	bob.close()
	require.Eventually(t, func() bool { return left.Load() == 5 }, 5*time.Second, 2*time.Millisecond)
	alice = connectWith(t, s, "report", "alice", alice.doc)
	alice.authenticate()
	alice.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 0, 0, "1") })
	guest = connectWith(t, s, "report", "guest", guest.doc)
	guest.authenticate()
	guest.eventually("synced", func() bool { return guest.doc.Texts("files")["/main.typ"] == "1AagG" })
	guest.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 5, 5, "2") })
	guest.eventually("refused", func() bool { return len(guest.reasons) == 1 })
	require.Equal(t, notYours, guest.reasons[0])
	alice.edit(func(w *ydoc.Writer) { w.Edit("files", "/main.typ", 5, 5, "3") })
	carol := dial(t, s, "report", "carol")
	carol.eventually("the room has alice's edits, not the guest's", func() bool { return carol.doc.Texts("files")["/main.typ"] == "1AagG3" })
	require.Equal(t, []string{"authenticated"}, alice.auth)
}

func TestAClientCannotChangeAnothersPresence(t *testing.T) {
	var left atomic.Int32
	s := newServer(t, memStore(t), users(&left))
	alice := dial(t, s, "r", "alice")
	update := awarenessUpdate(7, 1, `{"user":"alice"}`)
	alice.send(msgAwareness, append([]byte{byte(len(update))}, update...))
	alice.eventually("echo", func() bool { return len(alice.awareness) == 1 })

	guest := dial(t, s, "r", "guest")
	guest.eventually("the room's presence", func() bool { return len(guest.awareness) == 1 })
	for _, state := range []string{`{"user":"mallory"}`, "null"} {
		spoof := awarenessUpdate(7, 9, state)
		guest.send(msgAwareness, append([]byte{byte(len(spoof))}, spoof...))
	}
	own := awarenessUpdate(8, 1, `{"user":"guest"}`)
	guest.send(msgAwareness, append([]byte{byte(len(own))}, own...))
	alice.eventually("alice gets the guest's own presence only", func() bool { return len(alice.awareness) == 2 })
	require.Equal(t, own, alice.awareness[1])

	carol := dial(t, s, "r", "carol")
	carol.send(msgQueryAwareness, nil)
	carol.eventually("alice's presence is unchanged", func() bool { return len(carol.awareness) == 2 })
	require.Contains(t, string(carol.awareness[1]), `{"user":"alice"}`)
	require.NotContains(t, string(carol.awareness[1]), "mallory")
}

// valueUnder is a Yjs update that sets key in root map "values" to the string v as the first item of client.
func valueUnder(client byte, key, v string) []byte {
	update := []byte{1, 1, client, 0, 0x20 | 8, 1} // a client, a struct, its clock 0; parentSub, ContentAny; parent by name
	update = append(update, lib0String("values")...)
	update = append(update, lib0String(key)...)
	update = append(update, 1, 119) // one value, a string
	update = append(update, lib0String(v)...)
	return append(update, 0) // no deletions
}

func TestAClientIDInSomeonesPresenceIsTheirs(t *testing.T) {
	var left atomic.Int32
	s := newServer(t, memStore(t), users(&left))
	alice := dial(t, s, "r", "alice")
	presence := awarenessUpdate(7, 1, `{"user":"alice"}`)
	alice.send(msgAwareness, append([]byte{byte(len(presence))}, presence...))
	guest := dial(t, s, "r", "guest")
	bob := dial(t, s, "r", "bob")
	guest.eventually("alice's presence", func() bool { return len(guest.awareness) == 1 })

	// alice has not edited yet: her client id, which the others learnt from her presence, is hers all the same
	for _, c := range []*client{guest, bob} {
		c.send(msgSync, ydoc.SyncUpdate(valueUnder(7, "k", "spoof")))
	}
	guest.eventually("guest refused", func() bool { return len(guest.reasons) == 1 })
	bob.eventually("bob refused", func() bool { return len(bob.reasons) == 1 })
	require.Equal(t, notYours, guest.reasons[0])
	require.Equal(t, notYours, bob.reasons[0])

	alice.send(msgSync, ydoc.SyncUpdate(valueUnder(7, "k", "alice")))
	carol := dial(t, s, "r", "carol")
	carol.eventually("alice's value", func() bool { return carol.doc.Values("values")["k"] == "alice" })
}
