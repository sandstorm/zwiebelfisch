package gitlab

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// A GitLab room in the real collaboration server: clients join over the Hocuspocus protocol (in-process,
// no port), save with a stateless message, and leave; the room commits by itself and unloads. Who joins
// is decided as the app does (Authorize, here with users by the session cookie's id).
func TestRoomInTheCollaborationServer(t *testing.T) {
	repo := newFakeRepo(initialFiles())
	x := New(Options{AutoCommit: time.Hour, Log: zerolog.Nop(), repository: func(string) Repository { return repo }})
	x.leaveDelay = 20 * time.Millisecond
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	authenticate := func(r *http.Request, room string) (collab.User, error) {
		c, _ := r.Cookie("session")
		user := collab.User{Provider: DefaultID, ID: c.Value}
		return user, x.Authorize(r.Context(), user, room)
	}
	s := collab.New(collab.Options{Store: st, Authenticate: authenticate, Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
	defer x.Close()
	defer func() { require.NoError(t, s.Close(context.Background())) }()

	a := join(t, s, "7")
	a.eventually("a has the branch", func() bool { return a.doc.Texts(filesMap)[mainTyp] == mainText })
	a.send(msgTypeAwareness, varBytes(awareness(7, `{"user":{"name":"Ann"}}`)))
	a.eventually("presence echoed", func() bool { return a.awareness > 0 })
	a.edit(func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
	b := join(t, s, "8")
	b.eventually("b has a's edit", func() bool { return strings.Contains(b.doc.Texts(filesMap)[mainTyp], "Opening") })

	a.send(msgTypeStateless, varString(`{"type":"gitlab:save","message":"Reword"}`))
	b.eventually("everyone hears of the commit", func() bool { return len(b.stateless) == 1 })
	require.Equal(t, message{Type: msgSaved, Sha: repo.head("main").sha, Author: "Zwiebelfisch"}, b.stateless[0])
	require.Equal(t, "Reword\n\nCo-authored-by: Ann <zwiebelfisch@localhost>", repo.head("main").message, "named by the awareness")

	a.send(msgTypeStateless, varString(`{"type":"gitlab:save"}`))
	a.eventually("only the saver hears there is nothing to commit", func() bool {
		return len(a.stateless) == 2 && a.stateless[1].Type == msgUnchanged
	})
	b.mu.Lock()
	require.Len(t, b.stateless, 1)
	b.mu.Unlock()

	// b may edit but not push to the (protected) branch: b's save is refused, to b alone
	repo.setAccess("8", Access{Role: "Developer", Edit: true})
	b.send(msgTypeStateless, varString(`{"type":"gitlab:save"}`))
	b.eventually("b is told", func() bool { return len(b.stateless) == 2 })
	require.Equal(t, message{Type: msgError, Message: "main is protected and you may not push to it."}, b.stateless[1])
	a.mu.Lock()
	require.Len(t, a.stateless, 2)
	a.mu.Unlock()

	// a Reporter cannot join
	repo.setAccess("9", Access{Role: "Reporter"})
	c := join(t, s, "9")
	c.eventually("refused", func() bool { return c.denied != "" })
	require.Equal(t, "Editing group/report needs the Developer role on GitLab; you are Reporter.", c.denied)

	a.edit(func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Second", "2nd") })
	b.eventually("synced", func() bool { return strings.Contains(b.doc.Texts(filesMap)[mainTyp], "2nd") })
	a.close()
	b.close()
	committed := func() bool {
		return repo.head("main").message == "Edits by Ann: main.typ\n\nCo-authored-by: Ann <zwiebelfisch@localhost>"
	}
	require.Eventually(t, committed, 5*time.Second, time.Millisecond, "committed by itself after everyone left")
	require.Eventually(t, func() bool { x.mu.Lock(); defer x.mu.Unlock(); return len(x.open) == 0 }, 5*time.Second, time.Millisecond, "unloaded")
}

const (
	msgTypeSync      = 0
	msgTypeAwareness = 1
	msgTypeAuth      = 2
	msgTypeStateless = 5
)

// testConn is a HocuspocusProvider stand-in on an in-memory transport.
type testConn struct {
	t      *testing.T
	in     chan []byte // to the server
	out    chan []byte // to the client
	closed chan struct{}
	once   sync.Once
	done   chan struct{}

	mu        sync.Mutex
	doc       *ydoc.Doc
	stateless []message
	awareness int
	denied    string // the reason of a PermissionDenied
}

type fromServerOrigin struct{ _ byte }

var serverOrigin = &fromServerOrigin{}

// join opens the room as the user with id user (the session cookie the app would read).
func join(t *testing.T, s *collab.Server, user string) *testConn {
	c := &testConn{t: t, in: make(chan []byte, 64), out: make(chan []byte, 1024), closed: make(chan struct{}), done: make(chan struct{}), doc: ydoc.New()}
	upgrade := httptest.NewRequest(http.MethodGet, "/", nil)
	upgrade.AddCookie(&http.Cookie{Name: "session", Value: user})
	served := make(chan struct{})
	go func() { defer close(served); s.Serve(context.Background(), c, upgrade) }()
	go c.read()
	c.doc.OnUpdate(func(update []byte, origin any) {
		if origin != serverOrigin {
			c.send(msgTypeSync, ydoc.SyncUpdate(update))
		}
	})
	t.Cleanup(func() { c.close(); <-served; <-c.done })
	c.send(msgTypeAuth, append([]byte{0}, varString("")...))
	c.send(msgTypeSync, c.doc.SyncStep1())
	return c
}

// the server's end of the transport
func (c *testConn) Read(ctx context.Context) ([]byte, error) {
	select {
	case msg := <-c.in:
		return msg, nil
	case <-c.closed:
		return nil, errors.New("closed")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *testConn) Write(_ context.Context, msg []byte) error {
	select {
	case c.out <- msg:
		return nil
	case <-c.closed:
		return errors.New("closed")
	}
}

func (c *testConn) Close(int, string) { c.close() }

func (c *testConn) close() { c.once.Do(func() { close(c.closed) }) }

func (c *testConn) send(typ byte, payload []byte) {
	msg := append(append(varString(roomName), typ), payload...)
	select {
	case c.in <- msg:
	case <-c.closed:
	}
}

func (c *testConn) read() {
	defer close(c.done)
	for {
		select {
		case msg := <-c.out:
			c.handle(msg)
		case <-c.closed:
			return
		}
	}
}

func (c *testConn) handle(msg []byte) {
	n := int(msg[0]) // room names here are < 128 bytes
	typ, payload := msg[1+n], msg[2+n:]
	c.mu.Lock()
	defer c.mu.Unlock()
	switch typ {
	case msgTypeSync:
		reply, isStep1, err := c.doc.HandleSync(payload, serverOrigin)
		require.NoError(c.t, err)
		if isStep1 {
			go c.send(msgTypeSync, reply)
		}
	case msgTypeAwareness:
		c.awareness++
	case msgTypeAuth:
		if payload[0] == 1 { // PermissionDenied, VarString(reason)
			c.denied = readVarString(payload[1:])
		}
	case msgTypeStateless:
		var m message
		require.NoError(c.t, json.Unmarshal([]byte(readVarString(payload)), &m))
		c.stateless = append(c.stateless, m)
	}
}

func (c *testConn) edit(fn func(w *ydoc.Writer, doc *ydoc.Doc)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	require.NoError(c.t, c.doc.Write(nil, func(w *ydoc.Writer) { fn(w, c.doc) }))
}

func (c *testConn) eventually(what string, ok func() bool) {
	c.t.Helper()
	require.Eventually(c.t, func() bool { c.mu.Lock(); defer c.mu.Unlock(); return ok() }, 5*time.Second, time.Millisecond, what)
}

// lib0 encoding (lengths as unsigned LEB128)
func varUint(n int) []byte {
	var b []byte
	for n >= 0x80 {
		b = append(b, byte(n)|0x80)
		n >>= 7
	}
	return append(b, byte(n))
}

func varBytes(b []byte) []byte  { return append(varUint(len(b)), b...) }
func varString(s string) []byte { return varBytes([]byte(s)) }
func awareness(client byte, state string) []byte {
	return append([]byte{1, client, 1}, varString(state)...) // one client, clock 1
}

func readVarString(b []byte) string {
	n, shift, i := 0, 0, 0
	for ; b[i] >= 0x80; i++ {
		n |= int(b[i]&0x7f) << shift
		shift += 7
	}
	n |= int(b[i]) << shift
	return string(b[i+1 : i+1+n])
}
