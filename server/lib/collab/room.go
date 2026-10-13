package collab

import (
	"time"

	"github.com/rs/zerolog"

	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// room is one loaded room: its document, presence and peers, owned by the goroutine in run.
type room struct {
	s     *Server
	name  string
	log   zerolog.Logger
	inbox chan func()   // unbuffered: a function sent is a function run
	done  chan struct{} // closed when run returns (the room unloaded)

	// owned by run's goroutine
	doc        *ydoc.Doc
	loadErr    error
	awareness  *ydoc.Awareness
	peers      map[*Peer]struct{}
	dirty      bool      // changed since the last store
	firstDirty time.Time // when the oldest unstored change came
	storeAt    *time.Timer
	unloaded   bool
	ext        Handler // nil: the extension left the room alone
}

func newRoom(s *Server, name string) *room {
	return &room{
		s: s, name: name, log: s.opts.Log.With().Str("room", name).Logger(),
		inbox: make(chan func()), done: make(chan struct{}),
		awareness: ydoc.NewAwareness(), peers: map[*Peer]struct{}{},
	}
}

// do queues fn to the room; false if the room has unloaded (fn will not run).
func (r *room) do(fn func()) bool {
	select {
	case r.inbox <- fn:
		return true
	case <-r.done:
		return false
	}
}

// call runs fn on the room and waits for it; false if the room has unloaded.
func (r *room) call(fn func()) bool {
	ran := make(chan struct{})
	if !r.do(func() { defer close(ran); fn() }) {
		return false
	}
	<-ran
	return true
}

func (r *room) run() {
	defer close(r.done)
	r.load()
	var storeAt <-chan time.Time
	for !r.unloaded {
		select {
		case fn := <-r.inbox:
			fn()
		case <-storeAt:
			r.store()
		}
		storeAt = nil
		if r.storeAt != nil && r.dirty {
			storeAt = r.storeAt.C
		}
	}
}

func (r *room) load() {
	state, err := r.s.opts.Store.Load(r.name)
	if err == nil && state != nil {
		r.doc, err = ydoc.Load(state)
	}
	if err != nil {
		r.log.Error().Err(err).Msg("cannot load the room")
		r.loadErr = err
		return
	}
	if r.doc == nil {
		r.doc = ydoc.New()
	}
	r.doc.OnUpdate(func(update []byte, _ any) {
		r.broadcast(msgSync, ydoc.SyncUpdate(update))
		r.changed()
	})
	if x := r.s.opts.Extension; x != nil {
		if r.ext, err = x.Open(&Room{r}, r.doc); err != nil {
			r.log.Warn().Err(err).Msg("cannot open the room")
			r.loadErr = err
			return
		}
	}
	r.log.Debug().Bool("new", state == nil).Msg("room loaded")
}

// add makes p a peer of the room and sends it the room's presence.
func (r *room) add(p *Peer) error {
	if r.loadErr != nil {
		r.unload()
		return r.loadErr
	}
	r.peers[p] = struct{}{}
	if update := r.awareness.Encode(); update != nil {
		p.send(msgAwareness, new(encoder).bytes(update).buf)
	}
	return nil
}

// leave removes p; the last one to leave unloads the room.
func (r *room) leave(p *Peer) {
	if _, ok := r.peers[p]; !ok {
		return
	}
	delete(r.peers, p)
	if update := r.awareness.Remove(p); update != nil {
		r.broadcast(msgAwareness, new(encoder).bytes(update).buf)
	}
	if len(r.peers) > 0 {
		return
	}
	r.store()
	if r.ext == nil || r.s.ctx.Err() != nil {
		r.unload()
		return
	}
	// the extension may want the room a while longer (e.g. to commit it); it is joinable meanwhile
	r.s.wg.Add(1) // the room's goroutine counts too, so a Close waiting for wg is not done yet
	go func() {
		defer r.s.wg.Done()
		r.ext.Left(r.s.ctx)
		r.do(func() {
			if len(r.peers) == 0 && !r.unloaded {
				r.store()
				r.unload()
			}
		})
	}()
}

func (r *room) unload() {
	if r.ext != nil {
		r.ext.Close()
	}
	r.unloaded = true
	r.s.forget(r)
	r.log.Debug().Msg("room unloaded")
}

// receive handles a message from p (sent to the room by p's connection).
func (r *room) receive(p *Peer, typ uint64, d *decoder) {
	switch typ {
	case msgSync, msgSyncReply:
		reply, isStep1, err := r.doc.HandleSync(d.rest(), p)
		switch {
		case err != nil:
			r.log.Warn().Err(err).Msg("bad sync message; closing the connection")
			p.conn.close(closeResetConnection, "Reset Connection")
		case isStep1:
			// Answer with what the client lacks and ask for what we lack (a client that edited offline has more).
			if typ == msgSync {
				p.send(msgSync, r.doc.SyncStep1())
			}
			p.send(msgSync, reply)
		default:
			// the client counts unacknowledged updates (provider.hasUnsyncedChanges)
			p.send(msgSyncStatus, new(encoder).uint(1).buf)
		}
	case msgAwareness:
		update := d.bytes()
		if err := d.err; err != nil {
			r.log.Debug().Err(err).Msg("bad awareness message")
			return
		}
		if err := r.awareness.Apply(update, p); err != nil {
			r.log.Debug().Err(err).Msg("bad awareness update")
			return
		}
		p.noteAwareness(r.awareness.States(p))
		// to everyone, the sender too: the provider closes a connection that has been silent for 30 s
		r.broadcast(msgAwareness, new(encoder).bytes(update).buf)
	case msgQueryAwareness:
		update := r.awareness.Encode()
		if update == nil {
			update = []byte{0} // no clients
		}
		p.send(msgAwareness, new(encoder).bytes(update).buf)
	case msgStateless:
		payload := d.string()
		if d.err == nil && r.ext != nil {
			r.ext.Stateless(p, payload)
		}
	case msgAuth:
		// a token refresh on an open room: nothing to do (Hocuspocus calls onTokenSync)
	default:
		r.log.Debug().Uint64("type", typ).Msg("ignoring a message of unknown type")
	}
}

func (r *room) broadcast(typ uint64, payload []byte) {
	for p := range r.peers {
		p.send(typ, payload)
	}
}

// changed schedules a store: after Debounce of quiet, but no later than MaxDebounce after the first change.
func (r *room) changed() {
	now := time.Now()
	if !r.dirty {
		r.dirty = true
		r.firstDirty = now
	}
	wait := min(r.s.opts.Debounce, r.firstDirty.Add(r.s.opts.MaxDebounce).Sub(now))
	if r.storeAt == nil {
		r.storeAt = time.NewTimer(wait)
	} else {
		r.storeAt.Reset(wait)
	}
}

func (r *room) store() {
	if !r.dirty {
		return
	}
	if err := r.s.opts.Store.Save(r.name, r.doc.State()); err != nil {
		r.log.Error().Err(err).Msg("cannot store the room") // stays dirty: the next change or leave retries
		return
	}
	r.dirty = false
	r.storeAt.Stop()
	r.log.Debug().Msg("room stored")
}
