package ydoc

import (
	"fmt"

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

// SyncStep1 is the message that asks a peer for what this document lacks.
func (d *Doc) SyncStep1() []byte { return ygsync.EncodeSyncStep1(d.d) }

// SyncUpdate wraps an update (from OnUpdate) as a sync message.
func SyncUpdate(update []byte) []byte { return ygsync.EncodeUpdate(update) }
