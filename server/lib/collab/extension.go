package collab

import (
	"context"

	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// Extension adds behaviour to rooms: GitLab rooms (package gitlab) load a branch into a room, commit it and
// merge upstream pushes. The server keeps the mechanism (connections, sync, storing, unloading); the
// extension decides what a room is.
type Extension interface {
	// Open is called on the room's goroutine once its document is loaded from the store, before anyone
	// joins, so it may take its time (e.g. load the room from elsewhere). doc may be used during Open only;
	// later through Room.Do. Open returns what the room does from now on, or nil to leave the room alone; an
	// error refuses the clients that came to open it.
	Open(r *Room, doc *ydoc.Doc) (Handler, error)
}

// Handler is what an extension does in one room. Stateless and Close are called on the room's goroutine
// (they must not call Room methods, which would wait for that goroutine; they may start goroutines that do).
type Handler interface {
	// Stateless receives a stateless message from p's client.
	Stateless(p *Peer, payload string)
	// Left is called when the last client left, on a goroutine of its own. The room stays loaded (and
	// joinable) until Left returns; then it unloads, unless someone came back. ctx ends when the server
	// closes.
	Left(ctx context.Context)
	// Close: the room unloads (its document is stored).
	Close()
}

// Room is a loaded room as an extension sees it. Its methods wait for the room's goroutine: call them from
// other goroutines only (not from a Handler method or inside Do).
type Room struct{ r *room }

// Name is the room's name.
func (r *Room) Name() string { return r.r.name }

// Do runs fn with the room's document on the room's goroutine and waits for it; changes fn makes reach the
// clients. False if the room has unloaded (fn did not run).
func (r *Room) Do(fn func(doc *ydoc.Doc)) bool {
	return r.r.call(func() { fn(r.r.doc) })
}

// BroadcastStateless sends a stateless message to every client in the room.
func (r *Room) BroadcastStateless(payload string) {
	r.r.do(func() { r.r.broadcast(msgStateless, new(encoder).string(payload).buf) })
}

// Empty is whether no client is in the room (also true once it has unloaded).
func (r *Room) Empty() bool {
	empty := true
	r.r.call(func() { empty = len(r.r.peers) == 0 })
	return empty
}
