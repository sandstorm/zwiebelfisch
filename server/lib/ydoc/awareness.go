package ydoc

import (
	"fmt"

	"github.com/reearth/ygo/awareness"
	"github.com/reearth/ygo/encoding"
)

// Awareness is a room's presence (who is there, their cursors): the y-protocols awareness states of all
// clients, which are relayed, never stored. The server has no state of its own in it.
//
// Every update is applied with an origin (the connection it came from) and its author (who that is). A
// client id belongs to the origin whose state for it was applied last, until Remove: Apply leaves out the
// entries for client ids of an origin of another author, so no author changes or removes another's
// presence. Remove takes exactly an origin's clients out, as Hocuspocus does. Not safe for concurrent use
// (like Doc).
type Awareness struct {
	a      *awareness.Awareness
	owners map[uint64]owner // client id → the origin it belongs to
}

// owner is an origin and its author: the origin Apply hands to ygo.
type owner struct{ origin, author any }

// NewAwareness returns an empty awareness.
func NewAwareness() *Awareness {
	// The server never sets a local state, so its own client id only has to differ from the browsers'
	// (random uint32s): pick one above that range.
	a := &Awareness{a: awareness.New(1 << 40), owners: map[uint64]owner{}}
	a.a.OnUpdate(func(e awareness.UpdateEvent) {
		if o, ok := e.Origin.(owner); ok {
			for _, id := range append(e.Added, e.Updated...) {
				a.owners[id] = o
			}
		}
	})
	return a
}

// Apply merges an awareness update (y-protocols encoding) that origin sent on behalf of author (both
// comparable) and returns the part of it to relay: its entries except those for client ids that belong to
// an origin of another author (nil: none is left).
func (a *Awareness) Apply(update []byte, origin, author any) ([]byte, error) {
	kept, err := a.keep(update, func(id uint64) bool {
		o, ok := a.owners[id]
		return !ok || o.author == author
	})
	if err == nil && kept != nil {
		err = a.a.ApplyUpdate(kept, owner{origin, author})
	}
	if err != nil {
		return nil, fmt.Errorf("ydoc: awareness update: %w", err)
	}
	return kept, nil
}

// keep re-encodes the entries of update whose client id may picks; nil if it picks none.
func (a *Awareness) keep(update []byte, may func(id uint64) bool) ([]byte, error) {
	type entry struct {
		id, clock uint64
		state     []byte
	}
	var entries []entry
	dec := encoding.NewDecoder(update)
	n, err := dec.ReadVarUint()
	for i := uint64(0); err == nil && i < n; i++ {
		var e entry
		if e.id, err = dec.ReadVarUint(); err != nil {
			break
		}
		if e.clock, err = dec.ReadVarUint(); err != nil {
			break
		}
		if e.state, err = dec.ReadVarBytes(); err == nil && may(e.id) {
			entries = append(entries, e)
		}
	}
	if err != nil || len(entries) == 0 {
		return nil, err
	}
	return encoding.EncodeBytes(func(enc *encoding.Encoder) {
		enc.WriteVarUint(uint64(len(entries)))
		for _, e := range entries {
			enc.WriteVarUint(e.id)
			enc.WriteVarUint(e.clock)
			enc.WriteVarBytes(e.state)
		}
	}), nil
}

// Encode returns an update with every present client, or nil if there is none.
func (a *Awareness) Encode() []byte {
	var ids []uint64
	for id, s := range a.a.GetStates() {
		if s.State != nil {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return a.a.EncodeUpdate(ids)
}

// States returns the states of the present clients that belong to origin (each a JSON object).
func (a *Awareness) States(origin any) []map[string]any {
	var states []map[string]any
	for id, s := range a.a.GetStates() {
		if o, ok := a.owners[id]; ok && o.origin == origin && s.State != nil {
			states = append(states, s.State)
		}
	}
	return states
}

// Remove takes out the clients that belong to origin and returns the update that tells the others (nil if
// none of them was present).
func (a *Awareness) Remove(origin any) []byte {
	states := a.a.GetStates()
	type gone struct{ id, clock uint64 }
	var removed []gone
	for id, o := range a.owners {
		if o.origin != origin {
			continue
		}
		delete(a.owners, id)
		if s, ok := states[id]; ok && s.State != nil {
			removed = append(removed, gone{id, s.Clock})
		}
	}
	if len(removed) == 0 {
		return nil
	}
	// A null state at the client's current clock: y-protocols (and ygo) accept a removal at an equal clock,
	// and not bumping it lets the client's own next update (clock + 1) bring it back after a reconnect.
	update := encoding.EncodeBytes(func(enc *encoding.Encoder) {
		enc.WriteVarUint(uint64(len(removed)))
		for _, g := range removed {
			enc.WriteVarUint(g.id)
			enc.WriteVarUint(g.clock)
			enc.WriteVarString("null")
		}
	})
	_ = a.a.ApplyUpdate(update, nil) // well-formed by construction
	return update
}
