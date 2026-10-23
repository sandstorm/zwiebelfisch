package gitlab

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// Rooms of one folder of a branch (`…@main:/reports/q1`): what of the repository reaches the room, files
// pulled in from outside the folder, and what a commit may do outside it.

const (
	folderRoom   = roomName + ":/reports/q1"
	q1Main       = "/reports/q1/main.typ"
	templateText = "#let report(body) = body\n\n#let note = [Note]\n"
)

func folderFiles() map[string]any {
	return map[string]any{
		q1Main: `#import "/template.typ": report` + "\n= Q1\n", "/reports/q1/img/chart.png": logo,
		"/reports/q2/main.typ": "= Q2\n", "/template.typ": templateText, "/logo.png": []byte{7}, "/README.md": "readme",
	}
}

// outsideWhy ends the notice of what a save left out.
const outsideWhy = " (outside the project folder /reports/q1, where files are only edited, never created, renamed or deleted)"

func setupFolder(t *testing.T) *env {
	return setup(t, setupOptions{files: folderFiles(), room: folderRoom})
}

// pulledIn is the room's meta.pulledIn.
func (e *env) pulledIn() []string {
	var paths []string
	e.host.Do(func(doc *ydoc.Doc) { paths = readPulledIn(doc) })
	return paths
}

func TestFolderRooms(t *testing.T) {
	t.Run("loads the folder's files only, at their paths in the repository", func(t *testing.T) {
		e := setupFolder(t)
		require.Equal(t, []string{q1Main}, e.paths())
		require.Equal(t, map[string]any{"/reports/q1/img/chart.png": blobSha(logo)}, e.assets())
		require.Equal(t, []string{q1Main}, slices.Sorted(maps.Keys(e.base().Texts)))
		require.Equal(t, []string{"/reports/q1/img/chart.png"}, slices.Sorted(maps.Keys(e.base().Assets)))
		require.Empty(t, e.pulledIn())
	})

	t.Run("pulls in a file from outside on request: a .typ file as text, any other by blob sha", func(t *testing.T) {
		e := setupFolder(t)
		require.Nil(t, e.room.pullIn("/template.typ"))
		require.Nil(t, e.room.pullIn("/logo.png"))
		require.Equal(t, templateText, e.text("/template.typ"))
		require.Equal(t, blobSha([]byte{7}), e.assets()["/logo.png"])
		require.Equal(t, templateText, e.base().Texts["/template.typ"])
		require.Equal(t, blobSha([]byte{7}), e.base().Assets["/logo.png"])
		require.Equal(t, []string{"/logo.png", "/template.typ"}, e.pulledIn())
		require.Nil(t, e.changes(), "nothing to commit")
		require.Equal(t, []byte{7}, e.get("/logo.png", "ann").Body.Bytes())

		require.Nil(t, e.room.pullIn("/template.typ"), "held already: nothing happens")
		require.Equal(t, []string{"/logo.png", "/template.typ"}, e.pulledIn())
	})

	t.Run("refuses what is no file of the base outside the folder; once the base has it, it comes", func(t *testing.T) {
		e := setupFolder(t)
		for path, why := range map[string]string{
			"/missing.typ":         "/missing.typ is not a file in the repository.",
			"/reports":             "/reports is not a file in the repository.",
			"/reports/q1/new.typ":  "/reports/q1/new.typ is in the project folder /reports/q1, not outside it.",
			q1Main:                 q1Main + " is in the project folder /reports/q1, not outside it.",
			"template.typ":         `"template.typ" is not a file name git takes.`,
			"/reports/../x.typ":    `"/reports/../x.typ" is not a file name git takes.`,
			"/.git/config":         `"/.git/config" is not a file name git takes.`,
			"@preview/pkg:1.0/lib": `"@preview/pkg:1.0/lib" is not a file name git takes.`,
		} {
			require.Equal(t, &message{Type: msgMissing, Path: path, Message: why}, e.room.pullIn(path), path)
		}
		require.Empty(t, e.pulledIn())

		e.repo.push("main", map[string]any{"/missing.typ": "here now"})
		_, err := e.room.pull(context.Background(), "token-1")
		require.NoError(t, err)
		require.Nil(t, e.room.pullIn("/missing.typ"))
		require.Equal(t, "here now", e.text("/missing.typ"))
	})

	t.Run("holds at most maxPulledIn files from outside, and reads none larger than maxBlobSize", func(t *testing.T) {
		files := folderFiles()
		for i := range maxPulledIn + 1 {
			files[fmt.Sprintf("/data/%03d.csv", i)] = "row"
		}
		e := setup(t, setupOptions{files: files, room: folderRoom})
		for i := range maxPulledIn {
			require.Nil(t, e.room.pullIn(fmt.Sprintf("/data/%03d.csv", i)))
		}
		refused := e.room.pullIn("/data/200.csv")
		require.NotNil(t, refused)
		require.Equal(t, "/data/200.csv is not loaded: a room holds at most 200 files from outside its folder /reports/q1.", refused.Message)
		require.Len(t, e.pulledIn(), maxPulledIn)

		big := setup(t, setupOptions{files: map[string]any{q1Main: "", "/big.typ": make([]byte, maxBlobSize+1)}, room: folderRoom})
		refused = big.room.pullIn("/big.typ")
		require.NotNil(t, refused)
		require.Equal(t, "a file is larger than 32 MiB, more than Zwiebelfisch reads", refused.Message)
		require.Empty(t, big.pulledIn())
	})

	t.Run("a stored room keeps its pulled-in files and merges upstream changes to them", func(t *testing.T) {
		first := setupFolder(t)
		require.Nil(t, first.room.pullIn("/template.typ"))
		var state []byte
		first.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		first.unload()

		first.repo.push("main", map[string]any{"/template.typ": "#let report(body) = [*#body*]\n"})
		again := setup(t, setupOptions{repo: first.repo, state: state, room: folderRoom})
		require.Equal(t, []string{"/template.typ"}, again.pulledIn())
		require.Equal(t, "#let report(body) = [*#body*]\n", again.text("/template.typ"))
		require.Equal(t, first.repo.head("main").sha, again.base().Sha)
	})

	t.Run("merges upstream changes to the folder and to pulled-in files, and ignores the others but for the base", func(t *testing.T) {
		e := setupFolder(t)
		require.Nil(t, e.room.pullIn("/template.typ"))
		e.edit("/template.typ", "[Note]", "[Mine]")
		head := e.repo.push("main", map[string]any{
			"/template.typ": "// theirs\n" + templateText, "/reports/q1/notes.typ": "notes", "/reports/q2/main.typ": "= Q2, pushed\n", "/other.typ": "new",
		})
		result, err := e.room.pull(context.Background(), "token-1")
		require.NoError(t, err)
		require.Equal(t, &message{Type: msgMerged, Sha: head}, result)
		require.Equal(t, "// theirs\n#let report(body) = body\n\n#let note = [Mine]\n", e.text("/template.typ"), "merged three-way")
		require.Equal(t, []string{q1Main, "/reports/q1/notes.typ", "/template.typ"}, e.paths())
		require.Equal(t, head, e.base().Sha)
		require.NotContains(t, e.base().Texts, "/reports/q2/main.typ")

		require.Equal(t, msgSaved, e.save("Template").Type)
		files := e.repo.texts()
		require.Equal(t, "// theirs\n#let report(body) = body\n\n#let note = [Mine]\n", files["/template.typ"], "a pulled-in file is committed")
		require.Equal(t, "= Q2, pushed\n", files["/reports/q2/main.typ"], "files the room does not hold stay as they are")
		require.Equal(t, "readme", files["/README.md"])
	})

	t.Run("commits no creation, rename or deletion outside the folder, even when a client writes the document directly", func(t *testing.T) {
		for name, change := range map[string]func(w *ydoc.Writer, doc *ydoc.Doc){
			"a new file outside": func(w *ydoc.Writer, _ *ydoc.Doc) { w.SetText(filesMap, "/new.typ", "x") },
			"a new asset outside": func(w *ydoc.Writer, _ *ydoc.Doc) {
				w.Set(assetsMap, "/reports/q2/upload.png", []byte{1})
			},
			"a pulled-in file deleted": func(w *ydoc.Writer, _ *ydoc.Doc) { w.Delete(filesMap, "/template.typ") },
			"a pulled-in file moved into the folder": func(w *ydoc.Writer, _ *ydoc.Doc) {
				w.Delete(filesMap, "/template.typ")
				w.SetText(filesMap, "/reports/q1/template.typ", templateText)
			},
			"a pulled-in asset moved": func(w *ydoc.Writer, doc *ydoc.Doc) {
				w.Set(assetsMap, "/reports/q1/logo.png", doc.Values(assetsMap)["/logo.png"])
				w.Delete(assetsMap, "/logo.png")
			},
			"a folder file moved out": func(w *ydoc.Writer, _ *ydoc.Doc) {
				w.Delete(assetsMap, "/reports/q1/img/chart.png")
				w.Set(assetsMap, "/chart.png", blobSha(logo))
			},
		} {
			t.Run(name, func(t *testing.T) {
				e := setupFolder(t)
				require.Nil(t, e.room.pullIn("/template.typ"))
				require.Nil(t, e.room.pullIn("/logo.png"))
				before := e.repo.head("main").sha
				e.editAs(ann, change)
				got := e.save("")
				require.Equal(t, msgError, got.Type)
				require.True(t, strings.HasPrefix(got.Message, "Not saved: /"), got.Message)
				require.True(t, strings.HasSuffix(got.Message, outsideWhy), got.Message)
				require.Equal(t, before, e.repo.head("main").sha)
				require.Zero(t, e.repo.count("commit main"))
				require.Equal(t, got.Message, e.commitFailure().Message, "shown to everyone")
				require.Equal(t, []string{"Ann"}, e.changes().Editors, "the edits stay for the next commit")
			})
		}

		e := setupFolder(t)
		require.Nil(t, e.room.pullIn("/template.typ"))
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) {
			w.SetText(filesMap, "/reports/q1/chapters/one.typ", "= One\n")
			w.Delete(filesMap, q1Main)
			replace(t, w, doc, "/template.typ", "body\n", "[#body]\n")
		})
		require.Equal(t, msgSaved, e.save("").Type, "in the folder anything goes; outside, edits")
		files := e.repo.texts()
		require.Equal(t, "= One\n", files["/reports/q1/chapters/one.typ"])
		require.NotContains(t, files, q1Main)
		require.Equal(t, "#let report(body) = [#body]\n\n#let note = [Note]\n", files["/template.typ"])
	})

	t.Run("commits the rest of a save and tells what it left out; deleting the left-out file in the room undoes it", func(t *testing.T) {
		e := setupFolder(t)
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) {
			w.SetText(filesMap, "/new.typ", "x")
			replace(t, w, doc, q1Main, "= Q1", "= First quarter")
		})
		got := e.save("")
		require.Equal(t, msgSaved, got.Type)
		files := e.repo.texts()
		require.Equal(t, `#import "/template.typ": report`+"\n= First quarter\n", files[q1Main])
		require.NotContains(t, files, "/new.typ")
		require.Equal(t, "Not saved: /new.typ"+outsideWhy, e.commitFailure().Message, "shown to everyone")
		e.clock.Advance(changesDelay)
		require.Equal(t, []changedFile{{"/new.typ", "added"}}, e.changes().Files, "the left-out file stays a change of the room")

		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { w.Delete(filesMap, "/new.typ") })
		e.clock.Advance(changesDelay)
		require.Nil(t, e.changes())
		require.Nil(t, e.commitFailure(), "nothing is left out any more")
		require.Equal(t, msgUnchanged, e.save("").Type)
	})

	t.Run("re-creates a pulled-in file the room changed and upstream deleted", func(t *testing.T) {
		e := setupFolder(t)
		require.Nil(t, e.room.pullIn("/logo.png"))
		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { w.Set(assetsMap, "/logo.png", []byte{8}) })
		e.repo.push("main", map[string]any{"/logo.png": nil})
		require.Equal(t, msgSaved, e.save("").Type, "merged, then the room's version created again")
		require.Equal(t, []byte{8}, e.repo.head("main").files["/logo.png"])
		require.Nil(t, e.commitFailure())
	})

	t.Run("a pulled-in .typ file the room changed and upstream deleted: deleted here it merges, created again it is committed", func(t *testing.T) {
		e := setupFolder(t)
		require.Nil(t, e.room.pullIn("/template.typ"))
		e.edit("/template.typ", "[Note]", "[Mine]")
		mine := e.text("/template.typ")
		e.repo.push("main", map[string]any{"/template.typ": nil})
		require.Equal(t, msgConflict, e.save("").Type)

		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { w.Delete(filesMap, "/template.typ") })
		require.Equal(t, msgUnchanged, e.save("").Type, "the deletion is upstream's: merged")
		require.Nil(t, e.conflict())
		require.Equal(t, e.repo.head("main").sha, e.base().Sha)

		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { w.SetText(filesMap, "/template.typ", mine) })
		require.Equal(t, msgSaved, e.save("").Type)
		require.Equal(t, mine, e.repo.texts()["/template.typ"])
	})

	t.Run("reads a request for a file", func(t *testing.T) {
		path, ok := parsePull(`{"type":"gitlab:pull","path":"/template.typ"}`)
		require.Equal(t, []any{"/template.typ", true}, []any{path, ok})
		_, ok = parsePull(`{"type":"gitlab:save"}`)
		require.False(t, ok)
		_, ok = parseSave(`{"type":"gitlab:pull","path":"/x"}`)
		require.False(t, ok)
	})
}

// A folder room in the real collaboration server against the fake GitLab: a client asks for a file from
// outside the folder over the WebSocket, and hears why one cannot come.
func TestFolderRoomAgainstTheFakeGitLab(t *testing.T) {
	fake := fakegitlab.New("group/report", fakegitlab.Files{
		"/reports/q1/main.typ": []byte(`#import "/template.typ": report`), "/template.typ": []byte(templateText), "/main.typ": []byte(mainText),
	})
	ann := fake.SetAccess("Ann", fakegitlab.Developer)
	x := New(Options{
		URL: fakegitlab.URL, Client: fake.Client(), AutoCommit: time.Hour, Log: zerolog.Nop(),
		Token: func(context.Context, string) (string, error) { return fake.TokenOf("Ann"), nil },
	})
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	authenticate := func(r *http.Request, room string) (collab.User, error) {
		user := collab.User{Provider: DefaultID, ID: fmt.Sprint(ann.ID), Name: "Ann"}
		return user, x.Authorize(r.Context(), user, room)
	}
	s := collab.New(collab.Options{Store: st, Authenticate: authenticate, Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
	defer x.Close()
	defer func() { require.NoError(t, s.Close(context.Background())) }()

	a := joinRoom(t, s, fmt.Sprint(ann.ID), folderRoom)
	a.eventually("a has the folder", func() bool { return a.doc.Texts(filesMap)[q1Main] != "" })
	require.NotContains(t, a.doc.Texts(filesMap), "/main.typ")
	a.send(msgTypeStateless, varString(`{"type":"gitlab:pull","path":"/template.typ"}`))
	a.eventually("the file came", func() bool { return a.doc.Texts(filesMap)["/template.typ"] == templateText })
	a.send(msgTypeStateless, varString(`{"type":"gitlab:pull","path":"/nowhere.typ"}`))
	a.eventually("a is told", func() bool { return len(a.stateless) == 1 })
	require.Equal(t, message{Type: msgMissing, Path: "/nowhere.typ", Message: "/nowhere.typ is not a file in the repository."}, a.stateless[0])
	require.True(t, strings.HasPrefix(fake.Text("main")["/template.typ"], "#let"))
}
