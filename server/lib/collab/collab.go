// Package collab is the collaboration server: it speaks the Hocuspocus protocol to the widget's
// HocuspocusProvider and keeps one Yjs document per room (= project).
//
// A client opens a room by name if Authenticate lets it. The server syncs the room's document with it,
// relays every change and presence update to the room's other clients, and stores the document (debounced,
// and when the last client leaves, after which the room unloads). An Extension decides what a room is.
//
// A room sees its events in order, and a slow client never blocks a room.
package collab

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/auth"
)

// Options configure a Server. Store and Authenticate are required.
type Options struct {
	// Store loads and saves room states.
	Store Store
	// Authenticate decides whether a client may open a room.
	Authenticate Authenticate
	// Debounce is the quiet time after a change before the room is stored (default 2 s); MaxDebounce bounds
	// how long changes stay unstored while edits keep coming (default 10 s). As in Hocuspocus.
	Debounce, MaxDebounce time.Duration
	// PingInterval is how often a connection is pinged (default 15 s, inside the provider's 30 s
	// messageReconnectTimeout); a client that sends nothing for three of them is dropped.
	PingInterval time.Duration
	// Extension, if set, adds behaviour to rooms (see Extension).
	Extension Extension
	// PeerChanged, if set, is told each time a client joined a room (joined) or left it, with its user. It runs
	// on the room's goroutine: it must not wait for the server (it may start goroutines that do).
	PeerChanged func(room string, user User, joined bool)
	Log         zerolog.Logger
}

// Store keeps room states (Yjs updates): store.Store.
type Store interface {
	// Load returns the room's state, or nil for a new room.
	Load(room string) ([]byte, error)
	Save(room string, state []byte) error
}

// Server serves rooms to connections. Create it with New; it is an http.Handler for the WebSocket.
type Server struct {
	opts   Options
	ctx    context.Context // ends every connection when cancelled (Close)
	cancel context.CancelFunc
	wg     sync.WaitGroup // connections and rooms
	// disconnects counts the Disconnect calls: a client let in while one ran is asked about again
	disconnects atomic.Uint64

	mu     sync.Mutex
	rooms  map[string]*room
	closed bool
}

// New returns a server with opts.
func New(opts Options) *Server {
	if opts.Debounce == 0 {
		opts.Debounce = 2 * time.Second
	}
	if opts.MaxDebounce == 0 {
		opts.MaxDebounce = 10 * time.Second
	}
	if opts.PingInterval == 0 {
		opts.PingInterval = 15 * time.Second
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{opts: opts, ctx: ctx, cancel: cancel, rooms: map[string]*room{}}
}

// ErrClosed is returned after Close.
var ErrClosed = errors.New("collab: server closed")

// Close ends all connections, stores every changed room and waits for that (or ctx).
func (s *Server) Close(ctx context.Context) error {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	s.cancel()
	done := make(chan struct{})
	go func() { s.wg.Wait(); close(done) }()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// ServeHTTP accepts a WebSocket (the room is named in each message, not in the URL) and serves it until it
// closes.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !auth.AllowedOrigin(r) {
		http.Error(w, "Forbidden: this page may not connect", http.StatusForbidden)
		return
	}
	// The origin is checked above, by the rule the session cookie is checked by.
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return // Accept has answered
	}
	ws.SetReadLimit(maxMessage)
	s.Serve(r.Context(), webSocket{ws}, r)
}

// maxMessage bounds one incoming message (a whole document state when a client syncs a large project).
const maxMessage = 64 << 20

// Transport is one client connection carrying binary messages: a WebSocket, or a pipe in tests.
type Transport interface {
	// Read returns the next message; an error ends the connection.
	Read(ctx context.Context) ([]byte, error)
	Write(ctx context.Context, msg []byte) error
	// Close closes the connection with a WebSocket close code.
	Close(code int, reason string)
}

// Serve runs one connection until it ends (the client closes, ctx or the server is done). r is the request
// that opened it (Authenticate reads it).
func (s *Server) Serve(ctx context.Context, t Transport, r *http.Request) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		t.Close(closeNormal, "server closed")
		return
	}
	s.wg.Add(1)
	s.mu.Unlock()
	defer s.wg.Done()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	newConn(s, t, r, ctx, cancel).run()
}

// webSocket is a Transport over github.com/coder/websocket.
type webSocket struct{ c *websocket.Conn }

func (w webSocket) Read(ctx context.Context) ([]byte, error) {
	_, msg, err := w.c.Read(ctx)
	return msg, err
}

func (w webSocket) Write(ctx context.Context, msg []byte) error {
	return w.c.Write(ctx, websocket.MessageBinary, msg)
}

func (w webSocket) Close(code int, reason string) { _ = w.c.Close(websocket.StatusCode(code), reason) }

// BroadcastStateless sends a stateless message to every client in room; nothing when it is not loaded.
func (s *Server) BroadcastStateless(room, payload string) {
	s.mu.Lock()
	r := s.rooms[room]
	s.mu.Unlock()
	if r != nil {
		(&Room{r}).BroadcastStateless(payload)
	}
}

// Disconnect refuses every client in any room that match picks (called on that room's goroutine), as a
// refused Auth: the client gets PermissionDenied with reason, leaves the room at once and gets nothing more
// of it. Its connection stays open for its other rooms; opening the room again asks Authenticate again. A
// client being let in meanwhile is asked about again (Authenticate) once in the room, and refused as well.
func (s *Server) Disconnect(match func(*Peer) bool, reason string) {
	s.disconnects.Add(1)
	s.mu.Lock()
	rooms := make([]*room, 0, len(s.rooms))
	for _, r := range s.rooms {
		rooms = append(rooms, r)
	}
	s.mu.Unlock()
	for _, r := range rooms {
		r.call(func() {
			for p := range r.peers {
				if match(p) {
					r.drop(p, reason)
				}
			}
		})
	}
}

// join adds p to its room (loading the room first if nobody is in it) and returns the room.
func (s *Server) join(p *Peer) (*room, error) {
	for {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return nil, ErrClosed
		}
		r := s.rooms[p.room]
		if r == nil {
			r = newRoom(s, p.room, p.user)
			s.rooms[p.room] = r
			s.wg.Add(1)
			go func() { defer s.wg.Done(); r.run() }()
		}
		s.mu.Unlock()
		var err error
		if r.call(func() { err = r.add(p) }) {
			return r, err
		}
		// the room was unloading when we came: the next one loads what it stored
	}
}

// forget drops r from the rooms (it unloaded).
func (s *Server) forget(r *room) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.rooms[r.name] == r {
		delete(s.rooms, r.name)
	}
}
