package collab

import (
	"errors"
	"strings"
)

// The Hocuspocus wire format, as @hocuspocus/provider 4.7 speaks it (provider/src/types.ts,
// common/src/auth.ts): every frame is VarString(address) + VarUint(type) + payload, where the address is
// the room name (or "room\0session" for providers with sessionAwareness). Numbers and strings use lib0's
// encoding: unsigned LEB128, strings and byte arrays prefixed with their length.
const (
	msgSync           = 0 // payload: a y-protocols sync message (not length-prefixed)
	msgAwareness      = 1 // payload: VarBytes(awareness update)
	msgAuth           = 2 // payload: VarUint(auth type) + VarString
	msgQueryAwareness = 3 // no payload: the client asks for all awareness states
	msgSyncReply      = 4 // like msgSync, but a SyncStep1 in it gets no SyncStep1 back
	msgStateless      = 5 // payload: VarString
	msgClose          = 7 // the provider detached from the room
	msgSyncStatus     = 8 // server → client: VarUint(1) "your update was applied"
	msgPing           = 9 // server → client, without an address: the provider answers msgPong
	msgPong           = 10

	authToken            = 0 // client → server: VarString(token) [+ VarString(provider version)]
	authPermissionDenied = 1 // server → client: VarString(reason)
	authAuthenticated    = 2 // server → client: VarString(scope)
)

// The close codes of @hocuspocus/common's CloseEvents.
const (
	closeNormal          = 1000
	closeResetConnection = 4205 // a message the server could not handle
)

// roomOf is the room an address names (an address may carry a provider session after a NUL).
func roomOf(address string) string {
	room, _, _ := strings.Cut(address, "\x00")
	return room
}

// encoder writes lib0-encoded values.
type encoder struct{ buf []byte }

func (e *encoder) uint(n uint64) *encoder {
	for n >= 0x80 {
		e.buf = append(e.buf, byte(n)|0x80)
		n >>= 7
	}
	e.buf = append(e.buf, byte(n))
	return e
}

func (e *encoder) bytes(b []byte) *encoder {
	e.uint(uint64(len(b)))
	e.buf = append(e.buf, b...)
	return e
}
func (e *encoder) string(s string) *encoder { return e.bytes([]byte(s)) }
func (e *encoder) raw(b []byte) *encoder    { e.buf = append(e.buf, b...); return e }

// frame starts a frame to address of the given type.
func frame(address string, typ uint64) *encoder {
	return new(encoder).string(address).uint(typ)
}

// decoder reads lib0-encoded values; after the first error every read returns zero values and err is set.
type decoder struct {
	buf []byte
	err error
}

var errShort = errors.New("collab: truncated message")

func (d *decoder) uint() uint64 {
	var n uint64
	for shift := 0; d.err == nil; shift += 7 {
		if len(d.buf) == 0 || shift > 63 {
			d.err = errShort
			break
		}
		b := d.buf[0]
		d.buf = d.buf[1:]
		n |= uint64(b&0x7f) << shift
		if b < 0x80 {
			return n
		}
	}
	return 0
}

func (d *decoder) bytes() []byte {
	n := d.uint()
	if d.err == nil && uint64(len(d.buf)) < n {
		d.err = errShort
	}
	if d.err != nil {
		return nil
	}
	b := d.buf[:n]
	d.buf = d.buf[n:]
	return b
}

func (d *decoder) string() string { return string(d.bytes()) }

func (d *decoder) rest() []byte { b := d.buf; d.buf = nil; return b }
