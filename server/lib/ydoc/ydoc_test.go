package ydoc_test

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/testutil"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

type origin struct{ name string }

func TestWriteEditsAtUTF16OffsetsInOneTransaction(t *testing.T) {
	d := ydoc.New()
	user := &origin{"alice"}
	var origins []any
	stop := d.OnUpdate(func(_ []byte, o any) { origins = append(origins, o) })
	defer stop()

	require.NoError(t, d.Write(user, func(w *ydoc.Writer) {
		w.SetText("files", "/main.typ", "a😀b𝄞c")
		w.Edit("files", "/main.typ", 3, 4, "B") // a😀 is 3 UTF-16 units, so [3,4) is "b"
		w.Edit("files", "/main.typ", 6, 6, "🎉") // after a😀B𝄞
		w.SetText("files", "/empty.typ", "")
	}))
	require.Equal(t, map[string]string{"/main.typ": "a😀B𝄞🎉c", "/empty.typ": ""}, d.Texts("files"))
	require.Equal(t, []any{user}, origins, "one transaction, one update, with the writer's origin")

	require.NoError(t, d.Write(nil, func(w *ydoc.Writer) { w.Delete("files", "/empty.typ") }))
	require.Equal(t, map[string]string{"/main.typ": "a😀B𝄞🎉c"}, d.Texts("files"))
}

func TestWriteRefusesBadEdits(t *testing.T) {
	d := ydoc.New()
	require.NoError(t, d.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/a.typ", "x😀y") }))
	for name, edit := range map[string]func(w *ydoc.Writer){
		"deleted before":    func(w *ydoc.Writer) { w.Delete("files", "/a.typ"); w.Edit("files", "/a.typ", 0, 0, "z") },
		"missing key":       func(w *ydoc.Writer) { w.Edit("files", "/nope.typ", 0, 0, "z") },
		"past the end":      func(w *ydoc.Writer) { w.Edit("files", "/a.typ", 0, 5, "") },
		"reversed":          func(w *ydoc.Writer) { w.Edit("files", "/a.typ", 2, 1, "") },
		"inside surrogate":  func(w *ydoc.Writer) { w.Edit("files", "/a.typ", 2, 2, "z") },
		"ends inside emoji": func(w *ydoc.Writer) { w.Edit("files", "/a.typ", 0, 2, "") },
		"all or nothing":    func(w *ydoc.Writer) { w.SetText("files", "/b.typ", "b"); w.Edit("files", "/a.typ", 9, 9, "") },
	} {
		t.Run(name, func(t *testing.T) {
			require.Error(t, d.Write(nil, edit))
			require.Equal(t, map[string]string{"/a.typ": "x😀y"}, d.Texts("files"))
		})
	}
}

func TestValuesNextToTexts(t *testing.T) {
	d := ydoc.New()
	since := int64(1_760_176_800_000) // above 2^31: a float64 on the wire, as lib0 writes JS numbers
	require.NoError(t, d.Write(nil, func(w *ydoc.Writer) {
		w.Set("meta", "baseSha", "abc")
		w.Set("meta", "changes", map[string]any{"since": since, "editors": []any{"Ann"}, "files": []any{}})
		w.Set("meta", "conflict", nil)
		w.Set("assets", "/a.png", []byte{1, 2})
		w.SetText("assets", "/text", "not a value")
	}))
	loaded, err := ydoc.Load(d.State())
	require.NoError(t, err)
	for _, doc := range []*ydoc.Doc{d, loaded} {
		meta := doc.Values("meta")
		require.Equal(t, "abc", meta["baseSha"])
		require.Contains(t, meta, "conflict")
		require.Nil(t, meta["conflict"])
		b, err := json.Marshal(meta["changes"])
		require.NoError(t, err)
		require.JSONEq(t, `{"since":1760176800000,"editors":["Ann"],"files":[]}`, string(b))
		require.Equal(t, map[string]any{"/a.png": []byte{1, 2}}, doc.Values("assets"), "texts left out")
	}

	// a value replaces a text and the other way round
	require.NoError(t, d.Write(nil, func(w *ydoc.Writer) {
		w.Set("assets", "/text", "sha")
		w.SetText("assets", "/a.png", "text now")
	}))
	require.Equal(t, map[string]any{"/text": "sha"}, d.Values("assets"))
	require.Equal(t, map[string]string{"/a.png": "text now"}, d.Texts("assets"))
	require.Error(t, d.Write(nil, func(w *ydoc.Writer) { w.Edit("assets", "/text", 0, 0, "x") }), "a value is no text")
}

func TestStateRoundTripAndUpdatesCarryOrigin(t *testing.T) {
	a := ydoc.New()
	b := ydoc.New()
	conn := &origin{"conn"}
	stop := b.OnUpdate(func(_ []byte, o any) { require.Same(t, conn, o) })
	a.OnUpdate(func(update []byte, _ any) { require.NoError(t, b.Apply(update, conn)) })
	require.NoError(t, a.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/x", "hello") }))
	require.NoError(t, a.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/x", 5, 5, " world") }))
	stop()
	require.Equal(t, a.Texts("files"), b.Texts("files"))

	c, err := ydoc.Load(b.State())
	require.NoError(t, err)
	require.Equal(t, map[string]string{"/x": "hello world"}, c.Texts("files"))

	_, err = ydoc.Load([]byte{0xff, 0x01})
	require.Error(t, err)
}

func TestUpdatesThatChangeNothingAreNotTold(t *testing.T) {
	server := ydoc.New()
	client := ydoc.New()
	var updates []byte
	client.OnUpdate(func(u []byte, _ any) { updates = u })
	require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/x", "hello") }))
	require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/x", 0, 1, "") }))
	require.NoError(t, server.Apply(client.State(), "client"))

	var told []any
	server.OnUpdate(func(_ []byte, o any) { told = append(told, o) })
	// what a client sends on (re)connecting: its whole state, which the server has (a deletion included)
	require.NoError(t, server.Apply(client.State(), "client"))
	require.NoError(t, server.Apply(updates, "client"))
	reply, _, err := client.HandleSync(server.SyncStep1(), "server")
	require.NoError(t, err)
	_, _, err = server.HandleSync(reply, "client")
	require.NoError(t, err)
	require.NoError(t, server.Write("server", func(*ydoc.Writer) {}))
	require.Empty(t, told)

	// a deletion alone is a change
	require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/x", 0, 1, "") }))
	require.NoError(t, server.Apply(updates, "client"))
	require.Equal(t, []any{"client"}, told)
	require.Equal(t, "llo", server.Texts("files")["/x"])
}

func TestSyncHandshake(t *testing.T) {
	server := ydoc.New()
	require.NoError(t, server.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/s", "server") }))
	client := ydoc.New()
	require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/c", "client") }))

	// client → server: step 1; server answers with step 2 (what the client lacks)
	reply, isStep1, err := server.HandleSync(client.SyncStep1(), "client")
	require.NoError(t, err)
	require.True(t, isStep1)
	_, isStep1, err = client.HandleSync(reply, "server")
	require.NoError(t, err)
	require.False(t, isStep1)
	// and the other way round
	reply, _, err = client.HandleSync(server.SyncStep1(), "server")
	require.NoError(t, err)
	_, _, err = server.HandleSync(reply, "client")
	require.NoError(t, err)
	require.Equal(t, map[string]string{"/s": "server", "/c": "client"}, server.Texts("files"))
	require.Equal(t, server.Texts("files"), client.Texts("files"))

	// an update message
	var update []byte
	stop := client.OnUpdate(func(u []byte, _ any) { update = u })
	require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/c", 0, 0, "the ") }))
	stop()
	reply, isStep1, err = server.HandleSync(ydoc.SyncUpdate(update), "client")
	require.NoError(t, err)
	require.Nil(t, reply)
	require.False(t, isStep1)
	require.Equal(t, "the client", server.Texts("files")["/c"])

	_, _, err = server.HandleSync([]byte{7}, "client")
	require.Error(t, err)
}

func TestHandleSyncFromRefusesWhatWaitsForChangesToComeOfARestrictedSender(t *testing.T) {
	asGuest := ydoc.Sender{Origin: "guest", Author: "guest", Restricted: true}
	server := ydoc.New()
	require.NoError(t, server.Write("server", func(w *ydoc.Writer) { w.SetText("files", "/a", "server") }))
	member, err := ydoc.Load(server.State())
	require.NoError(t, err)
	// what the member does next, which the server does not hold yet
	updateOf := func(d *ydoc.Doc, fn func(w *ydoc.Writer)) []byte {
		var update []byte
		stop := d.OnUpdate(func(u []byte, _ any) { update = u })
		defer stop()
		require.NoError(t, d.Write(nil, fn))
		return update
	}
	first := updateOf(member, func(w *ydoc.Writer) { w.SetText("files", "/m", "member") })
	second := updateOf(member, func(w *ydoc.Writer) { w.Edit("files", "/m", 0, 0, "the ") })
	guest, err := ydoc.Load(server.State())
	require.NoError(t, err)
	require.NoError(t, guest.Apply(first, nil))

	// a sync and an edit of what the server holds take effect
	reply, isStep1, err := server.HandleSyncFrom(guest.SyncStep1(), asGuest)
	require.NoError(t, err)
	require.True(t, isStep1)
	_, _, err = guest.HandleSync(reply, "server")
	require.NoError(t, err)
	edit := updateOf(guest, func(w *ydoc.Writer) { w.Edit("files", "/a", 0, 0, "the ") })
	_, _, err = server.HandleSyncFrom(ydoc.SyncUpdate(edit), asGuest)
	require.NoError(t, err)
	require.Equal(t, "the server", server.Texts("files")["/a"])

	// deleting what the member has not sent yet, or adding the member's later change without the first: refused, unapplied
	ahead := updateOf(guest, func(w *ydoc.Writer) { w.Edit("files", "/m", 0, 1, "") })
	for name, update := range map[string][]byte{"delete ahead": ahead, "gap": second} {
		_, _, err = server.HandleSyncFrom(ydoc.SyncUpdate(update), asGuest)
		require.ErrorIs(t, err, ydoc.ErrNotAtOnce, name)
	}
	_, _, err = server.HandleSync(ydoc.SyncUpdate(first), "member")
	require.NoError(t, err)
	require.Equal(t, "member", server.Texts("files")["/m"], "nothing of the refused updates waited")

	// items that wait for the member's change still to come: refused (they are kept)
	later := updateOf(member, func(w *ydoc.Writer) { w.Edit("files", "/m", 0, 0, "X") })
	guest2, err := ydoc.Load(server.State())
	require.NoError(t, err)
	require.NoError(t, guest2.Apply(second, nil))
	require.NoError(t, guest2.Apply(later, nil))
	waits := updateOf(guest2, func(w *ydoc.Writer) { w.Edit("files", "/m", 1, 1, "Y") })
	_, _, err = server.HandleSyncFrom(ydoc.SyncUpdate(waits), asGuest)
	require.ErrorIs(t, err, ydoc.ErrNotAtOnce)
}

func TestAwarenessRemovesWhatAnOriginBroughtIn(t *testing.T) {
	// updates as y-protocols encodes them: count, then (client id, clock, JSON state) per client
	update := func(entries ...any) []byte {
		out := []byte{byte(len(entries) / 3)}
		for i := 0; i < len(entries); i += 3 {
			state := entries[i+2].(string)
			out = append(out, byte(entries[i].(int)), byte(entries[i+1].(int)), byte(len(state)))
			out = append(out, state...)
		}
		return out
	}
	a := ydoc.NewAwareness()
	require.Nil(t, a.Encode())
	one, two := &origin{"one"}, &origin{"two"}
	apply := func(update []byte, o *origin) error {
		relay, err := a.Apply(update, o, func(uint64) bool { return true })
		if err == nil {
			require.Equal(t, update, relay, "all of it is relayed")
		}
		return err
	}
	require.NoError(t, apply(update(11, 1, `{"user":"a"}`, 12, 1, `{"user":"b"}`), one))
	require.NoError(t, apply(update(21, 1, `{"user":"c"}`), two))
	require.Error(t, apply([]byte{1, 2}, two))

	require.Equal(t, []map[string]any{{"user": "c"}}, a.States(two))
	require.Len(t, a.States(one), 2)

	removal := a.Remove(one)
	require.NotNil(t, removal)
	require.Empty(t, a.States(one))
	require.Nil(t, a.Remove(one), "nothing left of one")

	other := ydoc.NewAwareness()
	_, err := other.Apply(a.Encode(), one, func(uint64) bool { return true })
	require.NoError(t, err)
	require.Equal(t, a.Encode(), other.Encode(), "only client 21 is present")
	require.Len(t, a.Encode(), len(update(21, 1, `{"user":"c"}`)))

	// the client comes back with its next clock after a reconnect
	require.NoError(t, apply(update(11, 2, `{"user":"a"}`), two))
	require.Len(t, a.Encode(), 1+2*(3+len(`{"user":"a"}`)))
}

func TestAwarenessLeavesOutEntriesItMayNotChange(t *testing.T) {
	update := func(id, clock byte, state string) []byte {
		return append([]byte{1, id, clock, byte(len(state))}, state...)
	}
	a := ydoc.NewAwareness()
	alice, bob := &origin{"alice"}, &origin{"bob"}
	_, err := a.Apply(update(7, 1, `{"user":"alice"}`), alice, func(uint64) bool { return true })
	require.NoError(t, err)

	// bob may not change client 7: his entries for it are left out, his own client in the same update is kept
	notSeven := func(client uint64) bool { return client != 7 }
	for _, state := range []string{`{"user":"mallory"}`, "null"} {
		relay, err := a.Apply(update(7, 5, state), bob, notSeven)
		require.NoError(t, err)
		require.Nil(t, relay, state)
	}
	both := append([]byte{2}, append(update(7, 6, `{"user":"mallory"}`)[1:], update(8, 1, `{"user":"bob"}`)[1:]...)...)
	relay, err := a.Apply(both, bob, notSeven)
	require.NoError(t, err)
	require.Equal(t, update(8, 1, `{"user":"bob"}`), relay)
	require.Equal(t, []map[string]any{{"user": "alice"}}, a.States(alice))
	require.Equal(t, []map[string]any{{"user": "bob"}}, a.States(bob))

	// a malformed update: nothing is asked or applied
	_, err = a.Apply(both[:len(both)-1], bob, func(uint64) bool { panic("asked") })
	require.Error(t, err)
}

func TestAwarenessMovesAClientToTheOriginThatUpdatedItLast(t *testing.T) {
	update := func(id, clock byte, state string) []byte {
		return append([]byte{1, id, clock, byte(len(state))}, state...)
	}
	all := func(uint64) bool { return true }
	a := ydoc.NewAwareness()
	alice, aliceAgain := &origin{"alice"}, &origin{"alice again"}
	_, err := a.Apply(update(7, 1, `{"user":"alice"}`), alice, all)
	require.NoError(t, err)

	// alice's other connection (a reconnect) takes her client over; her old connection leaving keeps it
	_, err = a.Apply(update(7, 2, `{"user":"alice"}`), aliceAgain, all)
	require.NoError(t, err)
	require.Nil(t, a.Remove(alice))
	require.Equal(t, []map[string]any{{"user": "alice"}}, a.States(aliceAgain))
	require.NotNil(t, a.Remove(aliceAgain))
	require.Nil(t, a.Encode())
}

func TestClaimTakesAClientIDAsItsItemsWould(t *testing.T) {
	member := func(name string) ydoc.Sender { return ydoc.Sender{Origin: name, Author: name} }
	guest := ydoc.Sender{Origin: "guest", Author: "guest", Restricted: true}
	server := ydoc.New()
	require.True(t, server.Claim(7, member("alice")))
	require.True(t, server.Claim(7, member("alice")), "hers already")
	require.False(t, server.Claim(7, member("bob")))
	require.False(t, server.Claim(7, guest))
	require.True(t, server.Claim(8, guest), "new to the document")
	var own []byte
	stopOwn := server.OnUpdate(func(u []byte, _ any) { own = u })
	require.NoError(t, server.Write("server", func(w *ydoc.Writer) { w.SetText("files", "/s", "") }))
	stopOwn()
	require.False(t, server.Claim(clientOf(own), member("alice")), "the document's own")

	// claimed without items: items of anybody else under it are refused
	alice := ydoc.New()
	var update []byte
	stop := alice.OnUpdate(func(u []byte, _ any) { update = u })
	require.NoError(t, alice.Write(nil, func(w *ydoc.Writer) { w.SetText("files", "/a", "alice") }))
	stop()
	client := clientOf(update)
	require.True(t, server.Claim(client, member("alice")))
	_, _, err := server.HandleSyncFrom(ydoc.SyncUpdate(update), member("bob"))
	require.ErrorIs(t, err, ydoc.ErrNotYours)
	_, _, err = server.HandleSyncFrom(ydoc.SyncUpdate(update), member("alice"))
	require.NoError(t, err)

	// a client id of the stored document that nobody took: a member's, never a guest's
	reloaded, err := ydoc.Load(server.State())
	require.NoError(t, err)
	require.False(t, reloaded.Claim(client, guest))
	require.True(t, reloaded.Claim(client, member("bob")))
	require.False(t, reloaded.Claim(client, member("alice")))
}

// clientOf is the client id of the first struct group of a Yjs v1 update.
func clientOf(update []byte) uint64 {
	var client uint64
	at := 2 // a client count, then the group's struct count (both < 128 here)
	for shift := 0; ; shift += 7 {
		client |= uint64(update[at]&0x7f) << shift
		at++
		if update[at-1] < 0x80 {
			return client
		}
	}
}

func TestHandleSyncFromKeepsClientIDsToTheirAuthor(t *testing.T) {
	member := func(name string) ydoc.Sender { return ydoc.Sender{Origin: name, Author: name} }
	guest := ydoc.Sender{Origin: "guest", Author: "guest", Restricted: true}
	server := ydoc.New()
	require.NoError(t, server.Write("server", func(w *ydoc.Writer) { w.SetText("files", "/a", "") }))
	alice, err := ydoc.Load(server.State())
	require.NoError(t, err)
	// alice's next update, which the server does not hold yet
	next := func(d *ydoc.Doc, insert string) []byte {
		var update []byte
		stop := d.OnUpdate(func(u []byte, _ any) { update = u })
		defer stop()
		require.NoError(t, d.Write(nil, func(w *ydoc.Writer) { w.Edit("files", "/a", 0, 0, insert) }))
		return ydoc.SyncUpdate(update)
	}
	send := func(d *ydoc.Doc, msg []byte, from ydoc.Sender) error {
		_, _, err := d.HandleSyncFrom(msg, from)
		return err
	}
	first := next(alice, "1")
	require.NoError(t, send(server, first, member("alice")))
	require.NoError(t, send(server, first, member("bob")), "what the server holds already is no change")

	// items under alice's client id from anybody else: refused, unapplied; alice's own go on
	second := next(alice, "2")
	require.ErrorIs(t, send(server, second, member("bob")), ydoc.ErrNotYours)
	require.ErrorIs(t, send(server, second, guest), ydoc.ErrNotYours)
	require.Equal(t, "1", server.Texts("files")["/a"])
	require.NoError(t, send(server, second, member("alice")))
	require.Equal(t, "21", server.Texts("files")["/a"])

	// a loaded document knows no authors: a member takes an existing client id, a guest may not
	reloaded, err := ydoc.Load(server.State())
	require.NoError(t, err)
	third := next(alice, "3")
	require.ErrorIs(t, send(reloaded, third, guest), ydoc.ErrNotYours)
	require.NoError(t, send(reloaded, third, member("alice")))
	require.ErrorIs(t, send(reloaded, next(alice, "4"), member("bob")), ydoc.ErrNotYours)

	// a guest's new client id is theirs
	visitor, err := ydoc.Load(reloaded.State())
	require.NoError(t, err)
	require.NoError(t, send(reloaded, next(visitor, "g"), guest))
	h := next(visitor, "h")
	require.ErrorIs(t, send(reloaded, h, member("alice")), ydoc.ErrNotYours)
	require.NoError(t, send(reloaded, h, guest))
	require.Equal(t, "hg321", reloaded.Texts("files")["/a"])
}

// fixtures are written by server/testdata/gen-fixtures.ts with the real yjs.
type fixture struct {
	Name    string
	Updates []string
	State   string
	Texts   map[string]map[string]string
}

func loadFixtures(t *testing.T) []fixture {
	raw, err := os.ReadFile(filepath.Join(testutil.RepoRoot(t), "server", "testdata", "yjs-fixtures.json"))
	require.NoError(t, err)
	var file struct{ Fixtures []fixture }
	require.NoError(t, json.Unmarshal(raw, &file))
	require.NotEmpty(t, file.Fixtures)
	return file.Fixtures
}

func decode(t *testing.T, s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	require.NoError(t, err)
	return b
}

func texts(d *ydoc.Doc, want map[string]map[string]string) map[string]map[string]string {
	got := map[string]map[string]string{}
	for m := range want {
		got[m] = d.Texts(m)
	}
	return got
}

func TestYjsFixtures(t *testing.T) {
	for _, f := range loadFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			inOrder := ydoc.New()
			for _, u := range f.Updates {
				require.NoError(t, inOrder.Apply(decode(t, u), nil))
			}
			require.Equal(t, f.Texts, texts(inOrder, f.Texts), "updates in order")

			reversed := ydoc.New()
			for _, u := range slices.Backward(f.Updates) {
				require.NoError(t, reversed.Apply(decode(t, u), nil))
			}
			require.Equal(t, f.Texts, texts(reversed, f.Texts), "updates in reverse (out of order) order")

			loaded, err := ydoc.Load(decode(t, f.State))
			require.NoError(t, err)
			require.Equal(t, f.Texts, texts(loaded, f.Texts), "the merged state")
		})
	}
}

// The other direction: what Go encodes, the real yjs decodes to the same texts.
func TestStateReadByYjs(t *testing.T) {
	for _, f := range loadFixtures(t) {
		t.Run(f.Name, func(t *testing.T) {
			d, err := ydoc.Load(decode(t, f.State))
			require.NoError(t, err)
			// Go edits on top of the yjs-made content (a second client id), including non-BMP text
			require.NoError(t, d.Write(nil, func(w *ydoc.Writer) {
				for key, text := range d.Texts("files") {
					w.Edit("files", key, 0, 0, "Go🦫 ")
					w.Edit("files", key, len(utf16(text))+5, len(utf16(text))+5, " 𝄞end")
				}
				w.SetText("files", "/from-go.typ", "née 😀 中文")
			}))
			want := texts(d, f.Texts)
			want["files"] = d.Texts("files")

			file := filepath.Join(t.TempDir(), "state.b64")
			require.NoError(t, os.WriteFile(file, []byte(base64.StdEncoding.EncodeToString(d.State())), 0o600))
			var got map[string]map[string]string
			require.NoError(t, json.Unmarshal(testutil.RunNode(t, "read-state.ts", append([]string{file}, keys(want)...)...), &got))
			require.Equal(t, want, got)
		})
	}
}

func TestValuesReadByYjs(t *testing.T) {
	d := ydoc.New()
	require.NoError(t, d.Write(nil, func(w *ydoc.Writer) {
		w.Set("meta", "changes", map[string]any{"since": float64(1_760_176_800_000), "editors": []any{"Ann"}})
		w.Set("meta", "autoCommit", 0.5)
		w.Set("meta", "conflict", nil)
		w.Set("assets", "/a.png", []byte{1, 2, 255})
		w.Set("assets", "/b.png", "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391")
	}))
	file := filepath.Join(t.TempDir(), "state.b64")
	require.NoError(t, os.WriteFile(file, []byte(base64.StdEncoding.EncodeToString(d.State())), 0o600))
	require.JSONEq(t, `{
		"meta": {"changes": {"since": 1760176800000, "editors": ["Ann"]}, "autoCommit": 0.5, "conflict": null},
		"assets": {"/a.png": {"bytes": [1, 2, 255]}, "/b.png": "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"}
	}`, string(testutil.RunNode(t, "read-state.ts", file, "=meta", "=assets")))
}

func utf16(s string) []uint16 {
	var units []uint16
	for _, r := range s {
		if r > 0xffff {
			units = append(units, 0, 0)
		} else {
			units = append(units, 0)
		}
	}
	return units
}

func keys(m map[string]map[string]string) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
