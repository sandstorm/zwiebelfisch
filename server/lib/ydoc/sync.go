package ydoc

import (
	"errors"
	"fmt"

	"github.com/reearth/ygo/crdt"
	ygsync "github.com/reearth/ygo/sync"
)

// The y-protocols sync protocol (SyncStep1 = state vector, SyncStep2 = what the other side lacks,
// Update = a change). Messages are the payload of a Hocuspocus Sync frame, without the frame header.

// HandleSync applies a sync message from a peer with origin. For a SyncStep1 it returns the SyncStep2 to
// send back (isStep1 = true); for a SyncStep2 or an Update it returns no reply.
func (d *Doc) HandleSync(msg []byte, origin any) (reply []byte, isStep1 bool, err error) {
	typ, _, err := ygsync.ReadSyncMessage(msg)
	if err != nil {
		return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
	}
	reply, err = ygsync.ApplySyncMessage(d.d, msg, origin)
	if err != nil {
		return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
	}
	return reply, typ == ygsync.MsgSyncStep1, nil
}

// ErrNotAtOnce: HandleSyncAtOnce refused an update that would wait for changes the document does not hold.
var ErrNotAtOnce = errors.New("ydoc: the update waits for changes the document does not hold")

// HandleSyncAtOnce is HandleSync for a peer whose every change must take effect as it arrives, with its own
// origin (collab: a guest's): an update that adds or deletes past what the document holds is refused
// with ErrNotAtOnce, unapplied, so no later change of another origin completes it. An update whose items
// wait for others' changes still to come is applied, its waiting items kept, and refused with ErrNotAtOnce.
func (d *Doc) HandleSyncAtOnce(msg []byte, origin any) (reply []byte, isStep1 bool, err error) {
	typ, update, err := ygsync.ReadSyncMessage(msg)
	if err != nil {
		return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
	}
	if typ != ygsync.MsgSyncStep1 {
		ids, err := crdt.ContentIDsFromUpdateV1(update)
		if err != nil {
			return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
		}
		if !holds(d.d.StateVector(), ids) {
			return nil, false, ErrNotAtOnce
		}
	}
	waiting := d.d.PendingStats().Items
	reply, isStep1, err = d.HandleSync(msg, origin)
	if err == nil && d.d.PendingStats().Items > waiting {
		err = ErrNotAtOnce
	}
	return reply, isStep1, err
}

// holds is whether a document at sv holds everything ids adds after and deletes: per client, each range
// added starts at or before what is held (sv, then what the update adds), each range deleted ends there.
func holds(sv crdt.StateVector, ids crdt.ContentIDs) bool {
	held := map[crdt.ClientID]uint64{}
	for _, c := range ids.Inserts.Clients() {
		end := sv.Clock(c)
		for _, r := range ids.Inserts.Ranges(c) {
			if r.Clock > end {
				return false
			}
			end = max(end, r.Clock+r.Len)
		}
		held[c] = end
	}
	for _, c := range ids.Deletes.Clients() {
		end, ok := held[c]
		if !ok {
			end = sv.Clock(c)
		}
		for _, r := range ids.Deletes.Ranges(c) {
			if r.Clock+r.Len > end {
				return false
			}
		}
	}
	return true
}

// SyncStep1 is the message that asks a peer for what this document lacks.
func (d *Doc) SyncStep1() []byte { return ygsync.EncodeSyncStep1(d.d) }

// SyncUpdate wraps an update (from OnUpdate) as a sync message.
func SyncUpdate(update []byte) []byte { return ygsync.EncodeUpdate(update) }
