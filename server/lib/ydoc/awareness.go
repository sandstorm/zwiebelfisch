package ydoc

import (
	"fmt"
	"slices"

	"github.com/reearth/ygo/awareness"
	"github.com/reearth/ygo/encoding"
)

// Awareness is a room's presence (who is there, their cursors): the y-protocols awareness states of all
// clients, which are relayed, never stored. The server has no state of its own in it.
//
// Every update is applied with an origin (the connection it came from) and the client ids it may change: Apply
// leaves out the entries for the others. A client id belongs to the origin whose state for it was applied
// last, until Remove, which takes exactly an origin's clients out, as Hocuspocus does. Not safe for
// concurrent use (like Doc).
type Awareness struct {
	a      *awareness.Awareness
	owners map[uint64]any // client id → the origin it belongs to
}

// NewAwareness returns an empty awareness.
func NewAwareness() *Awareness {
	// The server never sets a local state, so its own client id only has to differ from the browsers'
	// (random uint32s): pick one above that range.
	a := &Awareness{a: awareness.New(1 << 40), owners: map[uint64]any{}}
	a.a.OnUpdate(func(e awareness.UpdateEvent) {
		if e.Origin != nil {
			for _, id := range append(e.Added, e.Updated...) {
				a.owners[id] = e.Origin
			}
		}
	})
	return a
}

// Apply merges the entries of an awareness update (y-protocols encoding) sent by origin (comparable, not
// nil) whose client id may picks, and returns them as the update to relay (nil: may picked none).
func (a *Awareness) Apply(update []byte, origin any, may func(client uint64) bool) ([]byte, error) {
	kept, err := a.keep(update, may)
	if err == nil && kept != nil {
		err = a.a.ApplyUpdate(kept, origin)
	}
	if err != nil {
		return nil, fmt.Errorf("ydoc: awareness update: %w", err)
	}
	return kept, nil
}

// keep re-encodes the entries of update whose client id may picks (asked once the whole update is read);
// nil if it picks none.
func (a *Awareness) keep(update []byte, may func(client uint64) bool) ([]byte, error) {
	type entry struct {
		id, clock uint64
		state     []byte
	}
	var entries []entry
	dec := encoding.NewDecoder(update)
	n, err := dec.ReadVarUint()
	for i := uint64(0); err == nil && i < n; i++ {
		var e entry
		if e.id, err = dec.ReadVarUint(); err == nil {
			if e.clock, err = dec.ReadVarUint(); err == nil {
				e.state, err = dec.ReadVarBytes()
				entries = append(entries, e)
			}
		}
	}
	if err != nil {
		return nil, err
	}
	entries = slices.DeleteFunc(entries, func(e entry) bool { return !may(e.id) })
	if len(entries) == 0 {
		return nil, nil
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
		if o, ok := a.owners[id]; ok && o == origin && s.State != nil {
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
		if o != origin {
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
