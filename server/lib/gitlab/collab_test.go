package gitlab

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/store"
	"typst-editor/server/lib/ydoc"
)

// A GitLab room in the real collaboration server: clients join over the Hocuspocus protocol (in-process,
// no port), save with a stateless message, and leave; the room commits by itself and unloads.
func TestRoomInTheCollaborationServer(t *testing.T) {
	repo := newFakeRepo(initialFiles())
	x := New(Options{
		Authenticate: collab.SharedToken(ptr("room-token")), AutoCommit: time.Hour, Log: zerolog.Nop(),
		repository: func(string) Repository { return repo },
	})
	x.leaveDelay = 20 * time.Millisecond
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	s := collab.New(collab.Options{Store: st, Authenticate: collab.SharedToken(ptr("room-token")), Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
	defer x.Close()
	defer func() { require.NoError(t, s.Close(context.Background())) }()

	a := join(t, s)
	a.eventually("a has the branch", func() bool { return a.doc.Texts(filesMap)[mainTyp] == mainText })
	a.send(msgTypeAwareness, varBytes(awareness(7, `{"user":{"name":"Ann"}}`)))
	a.eventually("presence echoed", func() bool { return a.awareness > 0 })
	a.edit(func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
	b := join(t, s)
	b.eventually("b has a's edit", func() bool { return strings.Contains(b.doc.Texts(filesMap)[mainTyp], "Opening") })

	a.send(msgTypeStateless, varString(`{"type":"gitlab:save","message":"Reword"}`))
	b.eventually("everyone hears of the commit", func() bool { return len(b.stateless) == 1 })
	require.Equal(t, message{Type: msgSaved, Sha: repo.head("main").sha, Author: "Typst editor"}, b.stateless[0])
	require.Equal(t, "Reword\n\nCo-authored-by: Ann <typst-editor@localhost>", repo.head("main").message, "named by the awareness")

	a.send(msgTypeStateless, varString(`{"type":"gitlab:save"}`))
	a.eventually("only the saver hears there is nothing to commit", func() bool {
		return len(a.stateless) == 2 && a.stateless[1].Type == msgUnchanged
	})
	b.mu.Lock()
	require.Len(t, b.stateless, 1)
	b.mu.Unlock()

	a.edit(func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Second", "2nd") })
	b.eventually("synced", func() bool { return strings.Contains(b.doc.Texts(filesMap)[mainTyp], "2nd") })
	a.close()
	b.close()
	committed := func() bool {
		return repo.head("main").message == "Edits by Ann: main.typ\n\nCo-authored-by: Ann <typst-editor@localhost>"
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
}

type fromServerOrigin struct{ _ byte }

var serverOrigin = &fromServerOrigin{}

func join(t *testing.T, s *collab.Server) *testConn {
	c := &testConn{t: t, in: make(chan []byte, 64), out: make(chan []byte, 1024), closed: make(chan struct{}), done: make(chan struct{}), doc: ydoc.New()}
	served := make(chan struct{})
	go func() { defer close(served); s.Serve(context.Background(), c) }()
	go c.read()
	c.doc.OnUpdate(func(update []byte, origin any) {
		if origin != serverOrigin {
			c.send(msgTypeSync, ydoc.SyncUpdate(update))
		}
	})
	t.Cleanup(func() { c.close(); <-served; <-c.done })
	c.send(msgTypeAuth, append([]byte{0}, varString("room-token")...))
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
