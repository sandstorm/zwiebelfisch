package ydoc

import (
	"fmt"

	"github.com/reearth/ygo/awareness"
	"github.com/reearth/ygo/encoding"
)

// Awareness is a room's presence (who is there, their cursors): the y-protocols awareness states of all
// clients, which are relayed, never stored. The server has no state of its own in it.
//
// Every update is applied with an origin (the connection it came from), and Awareness remembers which
// clients each origin brought in: when a connection goes, Remove takes exactly its clients out, as
// Hocuspocus does. Not safe for concurrent use (like Doc).
type Awareness struct {
	a      *awareness.Awareness
	owners map[uint64]any // client id → origin that added it
}

// NewAwareness returns an empty awareness.
func NewAwareness() *Awareness {
	// The server never sets a local state, so its own client id only has to differ from the browsers'
	// (random uint32s): pick one above that range.
	a := &Awareness{a: awareness.New(1 << 40), owners: map[uint64]any{}}
	a.a.OnChange(func(e awareness.ChangeEvent) {
		for _, id := range e.Added {
			a.owners[id] = e.Origin
		}
		for _, id := range e.Removed {
			delete(a.owners, id)
		}
	})
	return a
}

// Apply merges an awareness update (y-protocols encoding) sent by origin.
func (a *Awareness) Apply(update []byte, origin any) error {
	if err := a.a.ApplyUpdate(update, origin); err != nil {
		return fmt.Errorf("ydoc: awareness update: %w", err)
	}
	return nil
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

// Remove takes out the clients that origin added and returns the update that tells the others (nil if
// origin had none).
func (a *Awareness) Remove(origin any) []byte {
	states := a.a.GetStates()
	type gone struct{ id, clock uint64 }
	var removed []gone
	for id, o := range a.owners {
		if s, ok := states[id]; o == origin && ok && s.State != nil {
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
	_ = a.a.ApplyUpdate(update, origin) // well-formed by construction
	return update
}
