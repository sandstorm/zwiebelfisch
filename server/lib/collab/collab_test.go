package collab_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/store"
	"typst-editor/server/lib/ydoc"
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
	foreign   []byte // types of messages to other addresses
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
	c := &client{t: t, address: address, p: newPipe(), done: make(chan struct{}), doc: ydoc.New()}
	upgrade := httptest.NewRequest(http.MethodGet, "/", nil)
	if session != "" {
		upgrade.AddCookie(&http.Cookie{Name: "session", Value: session})
	}
	served := make(chan struct{})
	go func() { defer close(served); s.Serve(context.Background(), c.p, upgrade) }()
	go c.read()
	c.doc.OnUpdate(func(update []byte, origin any) {
		if origin != fromServer {
			c.send(msgSync, ydoc.SyncUpdate(update))
		}
	})
	t.Cleanup(func() { c.close(); <-served; <-c.done })
	return c
}

// authenticate sends the provider's Auth message (its token is empty: the widget sends none), then SyncStep1.
func (c *client) authenticate() {
	c.send(msgAuth, append([]byte{0}, lib0String("")...))
	c.send(msgSync, c.doc.SyncStep1())
}

func lib0String(s string) []byte { return append([]byte{byte(len(s))}, s...) }

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
	n := int(msg[0])
	address, typ, payload := string(msg[1:1+n]), msg[1+n], msg[2+n:]
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

// extension is an Extension for tests: it opens every room whose name starts with "x-", records what it
// is told and lets the test decide when Left returns.
type extension struct {
	stateless chan got
	opened    chan *collab.Room
	left      chan chan struct{} // per Left call: closed by the test to let it return
	closed    chan string
}

type got struct {
	room, payload, name string
	user                collab.User
}

func newExtension() *extension {
	return &extension{stateless: make(chan got, 8), opened: make(chan *collab.Room, 8), left: make(chan chan struct{}, 8), closed: make(chan string, 8)}
}

func (x *extension) Open(r *collab.Room, doc *ydoc.Doc) (collab.Handler, error) {
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

func (h *handler) Left(ctx context.Context) {
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
