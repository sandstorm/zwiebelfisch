package collab

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog"
)

// conn is one client connection. A connection can open several rooms (one provider each), so it has a
// Peer per address. Only run's goroutine touches peers and pending.
type conn struct {
	s       *Server
	t       Transport
	req     *http.Request // that opened the connection: who it is (Authenticate)
	ctx     context.Context
	cancel  context.CancelFunc
	log     zerolog.Logger
	out     chan []byte // to the writer; never closed (rooms may still send after the end: dropped)
	closer  sync.Once
	closing sync.WaitGroup

	peers        map[string]*Peer    // by address, once authenticated
	pending      map[string][][]byte // by address: messages that came before the room's Auth
	pendingBytes int
}

// Limits for messages a client sends before it has authenticated (as Hocuspocus has them).
const (
	maxPendingMessages = 256
	maxPendingBytes    = 16 << 20
	// outgoing messages a client may fall behind by before it is dropped
	maxQueued = 1024
	// rooms one connection may have open at once, and the longest room name (in bytes)
	maxRooms    = 16
	maxRoomName = 1024
)

func newConn(s *Server, t Transport, req *http.Request, ctx context.Context, cancel context.CancelFunc) *conn {
	return &conn{
		s: s, t: t, req: req, ctx: ctx, cancel: cancel, log: s.opts.Log,
		out: make(chan []byte, maxQueued), peers: map[string]*Peer{}, pending: map[string][][]byte{},
	}
}

func (c *conn) run() {
	writerDone := make(chan struct{})
	go func() { defer close(writerDone); c.write() }()
	defer func() {
		for _, p := range c.peers {
			p.leave()
		}
		c.close(closeNormal, "")
		c.closing.Wait()
		<-writerDone
	}()
	idle := 3 * c.s.opts.PingInterval
	for {
		ctx, cancel := context.WithTimeout(c.ctx, idle)
		msg, err := c.t.Read(ctx)
		cancel()
		if err != nil {
			return // closed, or silent for too long
		}
		if len(msg) == 1 && msg[0] == msgPong { // the only message without an address
			continue
		}
		d := &decoder{buf: msg}
		address := d.string()
		typ := d.uint()
		if d.err != nil {
			c.log.Debug().Err(d.err).Msg("bad message; closing the connection")
			c.close(closeResetConnection, "Reset Connection")
			return
		}
		p := c.peers[address]
		if p != nil && p.dropped.Load() { // Disconnect: the room is closed to it until a new Auth
			delete(c.peers, address)
			p = nil
		}
		if p != nil {
			if typ == msgClose {
				p.leave()
				delete(c.peers, address)
				continue
			}
			p.receive(msg)
			continue
		}
		if typ == msgAuth {
			c.authenticate(address, d)
			continue
		}
		c.pending[address] = append(c.pending[address], msg)
		c.pendingBytes += len(msg)
		if len(c.pending[address]) > maxPendingMessages || c.pendingBytes > maxPendingBytes {
			c.log.Warn().Msg("too many messages before authentication; closing the connection")
			c.close(closeResetConnection, "Reset Connection")
			return
		}
	}
}

// authenticate handles the Auth message that opens the room at address: on success the client is told so,
// joins the room and the messages it sent before are handled; otherwise it gets PermissionDenied (and may
// try again), also once in the room when a Disconnect ran meanwhile and Authenticate now refuses it. A
// connection opens at most maxRooms rooms, with names of at most maxRoomName bytes.
func (c *conn) authenticate(address string, d *decoder) {
	queued := c.pending[address]
	delete(c.pending, address)
	for _, msg := range queued {
		c.pendingBytes -= len(msg)
	}
	room := roomOf(address)
	authType := d.uint()
	d.string() // the token: unused, the connection's request says who it is
	if d.err != nil || authType != authToken {
		c.log.Debug().Str("room", room).Msg("bad auth message")
		c.send(frame(address, msgAuth).uint(authPermissionDenied).string("permission-denied").buf)
		return
	}
	disconnects := c.s.disconnects.Load()
	user, err := c.admit(room)
	if err != nil {
		c.log.Info().Str("room", room).Err(err).Msg("permission denied")
		c.send(frame(address, msgAuth).uint(authPermissionDenied).string(refusalReason(err)).buf)
		return
	}
	c.send(frame(address, msgAuth).uint(authAuthenticated).string("read-write").buf)
	p := &Peer{conn: c, address: address, room: room, user: user}
	if p.r, err = c.s.join(p); err != nil {
		c.log.Error().Str("room", room).Err(err).Msg("cannot open the room; closing the connection")
		c.close(closeResetConnection, "Reset Connection")
		return
	}
	c.peers[address] = p
	if c.s.disconnects.Load() != disconnects { // one ran while p was let in, maybe before p was in the room
		if _, err := c.s.opts.Authenticate(c.req, room); err != nil {
			p.r.call(func() {
				if !p.dropped.Load() {
					p.r.drop(p, refusalReason(err))
				}
			})
			return
		}
	}
	for _, msg := range queued {
		p.receive(msg)
	}
}

// refusalReason is what a client refused with err is told: a Refusal's reason, else "permission-denied".
func refusalReason(err error) string {
	var refusal Refusal
	if errors.As(err, &refusal) {
		return refusal.Reason
	}
	return "permission-denied"
}

// admit returns who opens room on this connection: refused beyond maxRooms or maxRoomName, else as
// Authenticate decides.
func (c *conn) admit(room string) (User, error) {
	switch {
	case len(room) > maxRoomName:
		return User{}, Refusal{Reason: fmt.Sprintf("A room name has at most %d bytes.", maxRoomName)}
	case len(c.peers) >= maxRooms:
		return User{}, Refusal{Reason: fmt.Sprintf("This connection has %d rooms open, the most it may; close one first.", maxRooms)}
	}
	return c.s.opts.Authenticate(c.req, room)
}

// send queues msg for the client; a client too far behind is disconnected.
func (c *conn) send(msg []byte) {
	select {
	case c.out <- msg:
	case <-c.ctx.Done():
	default:
		c.log.Warn().Msg("client too slow; closing the connection")
		c.close(closeResetConnection, "Reset Connection")
	}
}

// write sends the queued messages, and a ping every PingInterval.
func (c *conn) write() {
	ping := time.NewTicker(c.s.opts.PingInterval)
	defer ping.Stop()
	for {
		msg := []byte{msgPing}
		select {
		case msg = <-c.out:
		case <-ping.C:
		case <-c.ctx.Done():
			return
		}
		if err := c.t.Write(c.ctx, msg); err != nil {
			c.cancel()
			return
		}
	}
}

// close ends the connection (once) with a close code: the reading and writing stop. It does not wait for
// the closing handshake, so rooms can call it.
func (c *conn) close(code int, reason string) {
	c.closer.Do(func() {
		c.closing.Add(1)
		go func() {
			defer c.closing.Done()
			c.t.Close(code, reason)
			c.cancel()
		}()
	})
}

// Peer is a client in a room: one connection's view of one room. It is the origin of the client's changes
// to the room's document.
type Peer struct {
	conn    *conn
	address string
	room    string
	user    User
	r       *room
	named   string      // the name the client publishes in the awareness (owned by the room's goroutine)
	dropped atomic.Bool // Server.Disconnect refused it
}

// User is who the client authenticated as.
func (p *Peer) User() User { return p.user }

// Request is the request that opened the client's connection (the WebSocket's upgrade: who it is, as
// Authenticate read it).
func (p *Peer) Request() *http.Request { return p.conn.req }

// Name is who the client is, by name: the user it authenticated as, else the name it publishes in the
// room's awareness (`user.name`, as the widget's collaboration extension does), else "". Read it on the
// room's goroutine (in a Handler method, an update listener of the document, or Room.Do).
func (p *Peer) Name() string {
	if p.user.Name != "" {
		return p.user.Name
	}
	return p.named
}

// noteAwareness remembers the name in the awareness states the client sent (the last one it named).
func (p *Peer) noteAwareness(states []map[string]any) {
	for _, s := range states {
		user, _ := s["user"].(map[string]any)
		if name, _ := user["name"].(string); strings.TrimSpace(name) != "" {
			p.named = strings.TrimSpace(name)
		}
	}
}

// Room is the room's name.
func (p *Peer) Room() string { return p.room }

// SendStateless sends p's client a stateless message (provider's onStateless).
func (p *Peer) SendStateless(payload string) {
	p.send(msgStateless, new(encoder).string(payload).buf)
}

func (p *Peer) send(typ uint64, payload []byte) {
	p.conn.send(frame(p.address, typ).raw(payload).buf)
}

// receive passes a whole message (address and type included) from p's client to the room.
func (p *Peer) receive(msg []byte) {
	d := &decoder{buf: msg}
	d.string()
	typ := d.uint()
	p.r.do(func() { p.r.receive(p, typ, d) })
}

func (p *Peer) leave() {
	p.r.call(func() { p.r.leave(p) })
}
