// Package ydoc is the server's Yjs document: the only package that imports the CRDT library
// (github.com/reearth/ygo, a pure-Go port of Yjs).
//
// The browser edits a room as a Yjs document, and the server must hold the same document: to relay and store
// it, and (for GitLab rooms) to read file texts and write edits of its own. ygo is young, so nothing else
// depends on it directly; swapping the CRDT means rewriting this package only.
//
// What a room looks like (src/core/room-protocol): root maps whose values are Y.Text, e.g. `files`
// (path → text). Offsets are UTF-16 code units, as in JavaScript (and in the Yjs wire format), not Go's
// UTF-8 bytes. Every change carries an origin (e.g. the connection that sent it), which update listeners
// receive, so the room knows who made an edit. Awareness (presence) lives in awareness.go, the sync protocol
// in sync.go.
package ydoc

import (
	"errors"
	"fmt"
	"unicode/utf16"

	"github.com/reearth/ygo/crdt"
)

// Doc is one room's document. Not safe for concurrent use: callers serialize access (collab runs each room
// on one goroutine).
type Doc struct{ d *crdt.Doc }

// New returns an empty document.
func New() *Doc { return &Doc{d: crdt.New()} }

// Load returns a document with the given state (from State, or any Yjs v1 update, e.g. `Y.encodeStateAsUpdate`).
func Load(state []byte) (*Doc, error) {
	d := New()
	if err := d.Apply(state, nil); err != nil {
		return nil, err
	}
	return d, nil
}

// State encodes the whole document as one Yjs v1 update (what storage keeps).
func (d *Doc) State() []byte { return d.d.EncodeStateAsUpdate() }

// Apply merges a Yjs v1 update; listeners see it with origin.
func (d *Doc) Apply(update []byte, origin any) error {
	if err := crdt.ApplyUpdateV1(d.d, update, origin); err != nil {
		return fmt.Errorf("ydoc: apply update: %w", err)
	}
	return nil
}

// OnUpdate calls fn after every change (local or applied) with the change as a Yjs v1 update and the origin
// it was made with. Pointer origins must point to non-zero-size types, or distinct ones compare equal.
func (d *Doc) OnUpdate(fn func(update []byte, origin any)) (stop func()) { return d.d.OnUpdate(fn) }

// Texts returns the texts in root map m (key → text); values that are not Y.Text are left out.
func (d *Doc) Texts(m string) map[string]string {
	texts := map[string]string{}
	for key, t := range d.textsIn(m) {
		texts[key] = t.ToString()
	}
	return texts
}

func (d *Doc) textsIn(m string) map[string]*crdt.YText {
	handles := map[string]*crdt.YText{}
	ymap := d.d.GetMap(m)
	for _, key := range ymap.Keys() { // not ForEach: it skips nested types
		if value, _ := ymap.Get(key); value != nil {
			if t, ok := value.(*crdt.YText); ok {
				handles[key] = t
			}
		}
	}
	return handles
}

// Write makes the changes fn asks for as one transaction with origin: listeners see one update. Either all
// changes are made or, if one is invalid (an edit of a missing text, a range outside the text or inside a
// surrogate pair), none and the error is returned.
func (d *Doc) Write(origin any, fn func(w *Writer)) error {
	w := &Writer{}
	fn(w)
	// ygo's read accessors take the document lock that Transact holds (and would deadlock inside it), so
	// everything is checked first, against the texts as they are now plus the earlier changes of this Write.
	handles := map[mapKey]*crdt.YText{}
	shadow := map[mapKey][]uint16{}
	read := map[string]bool{}
	for _, op := range w.ops {
		k := mapKey{op.m, op.key}
		if !read[op.m] {
			read[op.m] = true
			for key, t := range d.textsIn(op.m) {
				if _, changed := shadow[mapKey{op.m, key}]; !changed {
					handles[mapKey{op.m, key}] = t
					shadow[mapKey{op.m, key}] = utf16.Encode([]rune(t.ToString()))
				}
			}
		}
		switch op.kind {
		case opSet:
			shadow[k] = utf16.Encode([]rune(op.text))
		case opDelete:
			shadow[k] = nil
		case opEdit:
			units, err := op.check(shadow[k])
			if err != nil {
				return err
			}
			shadow[k] = units
		}
	}
	d.d.Transact(func(txn *crdt.Transaction) {
		for _, op := range w.ops {
			k := mapKey{op.m, op.key}
			switch op.kind {
			case opSet:
				t := crdt.NewTextPrelim()
				txn.GetMap(op.m).Set(txn, op.key, t)
				if op.text != "" {
					t.Insert(txn, 0, op.text, nil)
				}
				handles[k] = t
			case opDelete:
				txn.GetMap(op.m).Delete(txn, op.key)
			case opEdit:
				if op.to > op.from {
					handles[k].Delete(txn, op.from, op.to-op.from)
				}
				if op.text != "" {
					handles[k].Insert(txn, op.from, op.text, nil)
				}
			}
		}
	}, origin)
	return nil
}

// Writer collects the changes of one Write.
type Writer struct{ ops []op }

// SetText puts a new Y.Text with text under key in root map m (replacing what was there).
func (w *Writer) SetText(m, key, text string) {
	w.ops = append(w.ops, op{kind: opSet, m: m, key: key, text: text})
}

// Edit replaces the UTF-16 range [from, to) of the text under key in root map m with insert.
func (w *Writer) Edit(m, key string, from, to int, insert string) {
	w.ops = append(w.ops, op{kind: opEdit, m: m, key: key, from: from, to: to, text: insert})
}

// Delete removes key from root map m.
func (w *Writer) Delete(m, key string) {
	w.ops = append(w.ops, op{kind: opDelete, m: m, key: key})
}

var (
	// ErrNoText: the key holds no Y.Text.
	ErrNoText = errors.New("no text under key")
	// ErrRange: offsets outside the text or between the two halves of a surrogate pair.
	ErrRange = errors.New("bad range")
)

type mapKey struct{ m, key string }

type opKind int

const (
	opSet opKind = iota
	opEdit
	opDelete
)

type op struct {
	kind     opKind
	m, key   string
	from, to int
	text     string
}

// check validates an edit against the text's UTF-16 units (nil: no text) and returns the units after it.
func (o op) check(units []uint16) ([]uint16, error) {
	if units == nil {
		return nil, fmt.Errorf("ydoc: edit %s %s: %w", o.m, o.key, ErrNoText)
	}
	if o.from < 0 || o.from > o.to || o.to > len(units) {
		return nil, fmt.Errorf("ydoc: edit %s %s: [%d, %d) outside 0..%d: %w", o.m, o.key, o.from, o.to, len(units), ErrRange)
	}
	// an edit there would leave half an emoji behind, which JavaScript shows as U+FFFD
	for _, i := range []int{o.from, o.to} {
		if i > 0 && i < len(units) && utf16.IsSurrogate(rune(units[i])) && units[i] >= 0xdc00 {
			return nil, fmt.Errorf("ydoc: edit %s %s: offset %d inside a surrogate pair: %w", o.m, o.key, i, ErrRange)
		}
	}
	out := append(append(append([]uint16{}, units[:o.from]...), utf16.Encode([]rune(o.text))...), units[o.to:]...)
	if len(out) == 0 {
		out = []uint16{} // empty text, not "no text"
	}
	return out, nil
}
