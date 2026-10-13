package ydoc_test

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/testutil"
	"typst-editor/server/lib/ydoc"
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
	require.NoError(t, a.Apply(update(11, 1, `{"user":"a"}`, 12, 1, `{"user":"b"}`), one))
	require.NoError(t, a.Apply(update(21, 1, `{"user":"c"}`), two))
	require.Error(t, a.Apply([]byte{1, 2}, two))

	require.Equal(t, []map[string]any{{"user": "c"}}, a.States(two))
	require.Len(t, a.States(one), 2)

	removal := a.Remove(one)
	require.NotNil(t, removal)
	require.Empty(t, a.States(one))
	require.Nil(t, a.Remove(one), "nothing left of one")

	other := ydoc.NewAwareness()
	require.NoError(t, other.Apply(a.Encode(), nil))
	require.Equal(t, a.Encode(), other.Encode(), "only client 21 is present")
	require.Len(t, a.Encode(), len(update(21, 1, `{"user":"c"}`)))

	// the client comes back with its next clock after a reconnect
	require.NoError(t, a.Apply(update(11, 2, `{"user":"a"}`), two))
	require.Len(t, a.Encode(), 1+2*(3+len(`{"user":"a"}`)))
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
