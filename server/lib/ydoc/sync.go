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

var (
	// ErrNotAtOnce: HandleSyncFrom refused an update that would wait for changes the document does not hold.
	ErrNotAtOnce = errors.New("ydoc: the update waits for changes the document does not hold")
	// ErrNotYours: HandleSyncFrom refused an update that adds items under a Yjs client id not the sender's.
	ErrNotYours = errors.New("ydoc: the update adds items under a client id that is not the sender's")
)

// Sender is who sends a sync message to HandleSyncFrom.
type Sender struct {
	// Origin is what update listeners see the changes with (collab: the client's connection).
	Origin any
	// Author is who the sender is (comparable; collab: the user).
	Author any
	// Restricted (collab: a guest): every change must take effect as it arrives, and only client ids new to
	// the document can become the sender's.
	Restricted bool
}

// HandleSyncFrom is HandleSync for a message from a sender who adds items only under Yjs client ids of
// their own. A client id is the author's who first added items under it with HandleSyncFrom or took it
// with Claim; the document's own (Write's) is nobody's to take. An update that adds items (past what the
// document holds) under a client id of another author, or, for a Restricted sender, under one the document
// holds items of that no author took (e.g. loaded ones), is refused with ErrNotYours, unapplied. Deletions
// are not checked.
//
// For a Restricted sender, an update that adds or deletes past what the document holds is refused with
// ErrNotAtOnce, unapplied, so no later change of another origin completes it; one whose items wait for
// others' changes still to come is applied, its waiting items kept, and refused with ErrNotAtOnce.
func (d *Doc) HandleSyncFrom(msg []byte, from Sender) (reply []byte, isStep1 bool, err error) {
	typ, update, err := ygsync.ReadSyncMessage(msg)
	if err != nil {
		return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
	}
	if typ != ygsync.MsgSyncStep1 {
		ids, err := crdt.ContentIDsFromUpdateV1(update)
		if err != nil {
			return nil, false, fmt.Errorf("ydoc: sync message: %w", err)
		}
		sv := d.d.StateVector()
		if from.Restricted && !holds(sv, ids) {
			return nil, false, ErrNotAtOnce
		}
		if err := d.claim(sv, ids.Inserts, from); err != nil {
			return nil, false, err
		}
	}
	if !from.Restricted {
		return d.HandleSync(msg, from.Origin)
	}
	waiting := d.d.PendingStats().Items
	reply, isStep1, err = d.HandleSync(msg, from.Origin)
	if err == nil && d.d.PendingStats().Items > waiting {
		err = ErrNotAtOnce
	}
	return reply, isStep1, err
}

// claim makes from's author the owner of the client ids that inserts adds items under past sv, or returns
// ErrNotYours, claiming none, if one of them is not theirs to have.
func (d *Doc) claim(sv crdt.StateVector, inserts *crdt.IDSet, from Sender) error {
	var claims []crdt.ClientID
	for _, c := range inserts.Clients() {
		for _, r := range inserts.Ranges(c) {
			if r.Clock+r.Len > sv.Clock(c) {
				if !d.mayOwn(c, sv, from) {
					return fmt.Errorf("%w (client %d)", ErrNotYours, c)
				}
				claims = append(claims, c)
				break
			}
		}
	}
	for _, c := range claims {
		d.owners[c] = from.Author
	}
	return nil
}

// Claim makes client from's author's, as HandleSyncFrom would for items under it, and reports whether it is
// theirs now (collab: for the client id of a presence, which is the client's Yjs client id).
func (d *Doc) Claim(client uint64, from Sender) bool {
	c := crdt.ClientID(client)
	if !d.mayOwn(c, d.d.StateVector(), from) {
		return false
	}
	d.owners[c] = from.Author
	return true
}

// mayOwn is whether client c of a document at sv may be from's author's: it is theirs already, or nobody's
// and new to the document or from is not Restricted.
func (d *Doc) mayOwn(c crdt.ClientID, sv crdt.StateVector, from Sender) bool {
	if owner, owned := d.owners[c]; owned {
		return owner == from.Author
	}
	return !from.Restricted || sv.Clock(c) == 0
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
