package gitlab

import (
	"context"
	"maps"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/ydoc"
)

// GitLab rooms against a repository in memory (fakeRepo), in a stand-in for the collaboration room
// (fakeHost), on a clock the test moves (fakeClock);
// collab_test.go runs a room in the real collaboration server.

func TestMain(m *testing.M) { goleak.VerifyTestMain(m) }

const (
	projectPath = "group/report"
	roomName    = "gitlab:" + projectPath + "@main"
	mainTyp     = "/main.typ"
	mainText    = "= Report\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n"
)

var (
	logo  = []byte{137, 80, 78, 71, 1, 2, 3}
	atTen = time.Date(2026, 10, 11, 10, 0, 0, 0, time.UTC)
)

func initialFiles() map[string]any {
	return map[string]any{mainTyp: mainText, "/ch1.typ": "= One\n\nText of one.\n", "/old.typ": "old\n", "/img/logo.png": logo}
}

type env struct {
	t     *testing.T
	repo  *fakeRepo
	clock *fakeClock
	x     *Rooms
	host  *fakeHost
	room  *room
}

type setupOptions struct {
	files      map[string]any
	autoCommit time.Duration
	repo       *fakeRepo // instead of a new one
	state      []byte    // a stored room
}

// setup opens a GitLab room (no auto-commit unless asked for) at 10:00.
func setup(t *testing.T, o setupOptions) *env {
	if o.files == nil {
		o.files = initialFiles()
	}
	if o.repo == nil {
		o.repo = newFakeRepo(o.files)
	}
	e := &env{t: t, repo: o.repo, clock: &fakeClock{now: atTen}}
	e.x = New(Options{
		URL: "https://gitlab.test", Token: "bot-token", Authenticate: collab.SharedToken(ptr("room-token")),
		WebhookSecret: "hook-secret", AutoCommit: o.autoCommit, Log: zerolog.Nop(),
		repository: func(p string) Repository { require.Equal(t, projectPath, p); return e.repo },
		clock:      e.clock,
	})
	doc := ydoc.New()
	if o.state != nil {
		var err error
		doc, err = ydoc.Load(o.state)
		require.NoError(t, err)
	}
	e.host = &fakeHost{doc: doc}
	var err error
	e.host.Do(func(doc *ydoc.Doc) { e.room, err = e.x.openRoom(roomName, e.host, doc) })
	require.NoError(t, err)
	t.Cleanup(e.unload)
	return e
}

// unload unloads the room as the collaboration server does, then closes the rooms.
func (e *env) unload() {
	e.host.Do(func(*ydoc.Doc) { e.room.Close() })
	e.host.mu.Lock()
	e.host.unloaded = true
	e.host.mu.Unlock()
	e.x.Close()
}

// save is a client pressing "Save version" (as Stateless does, without a connection to answer).
func (e *env) save(text string) message {
	who, text, ok := parseSave(collab.User{}, `{"type":"gitlab:save","message":`+quote(text)+`,"author":{"name":"Ann"}}`)
	require.True(e.t, ok)
	return e.room.save(context.Background(), who, text)
}

func quote(s string) string { return `"` + strings.ReplaceAll(s, `"`, `\"`) + `"` }

// editAs changes the document as client c would (nil: someone unknown).
func (e *env) editAs(c *testClient, fn func(w *ydoc.Writer, doc *ydoc.Doc)) {
	var origin any
	if c != nil {
		origin = c
	}
	e.host.Do(func(doc *ydoc.Doc) {
		require.NoError(e.t, doc.Write(origin, func(w *ydoc.Writer) { fn(w, doc) }))
	})
}

// edit replaces from with to in the text at path, as someone unknown.
func (e *env) edit(path, from, to string) {
	e.editAs(nil, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(e.t, w, doc, path, from, to) })
}

// replace replaces from with to in the text at path (texts as they were before this Write).
func replace(t *testing.T, w *ydoc.Writer, doc *ydoc.Doc, path, from, to string) {
	text := doc.Texts(filesMap)[path]
	at := strings.Index(text, from)
	require.GreaterOrEqual(t, at, 0, "%q in %q", from, text)
	start := units(text[:at])
	w.Edit(filesMap, path, start, start+units(from), to)
}

var (
	ann  = &testClient{"Ann", "ann@example.com"}
	bob  = &testClient{"Bob", "bob@example.com"}
	cleo = &testClient{"Cleo", "cleo@example.com"}
)

func (e *env) text(path string) string {
	var text string
	e.host.Do(func(doc *ydoc.Doc) { text = doc.Texts(filesMap)[path] })
	return text
}

func (e *env) paths() []string {
	var paths []string
	e.host.Do(func(doc *ydoc.Doc) {
		for p := range doc.Texts(filesMap) {
			paths = append(paths, p)
		}
	})
	return slices.Sorted(slices.Values(paths))
}

func (e *env) assets() map[string]any {
	var assets map[string]any
	e.host.Do(func(doc *ydoc.Doc) { assets = doc.Values(assetsMap) })
	return assets
}

func (e *env) base() *base {
	var b *base
	e.host.Do(func(doc *ydoc.Doc) { b = readMeta(doc) })
	return b
}

// meta decodes the meta value under key into v; false if it is missing or null.
func (e *env) meta(key string, v any) bool {
	var ok bool
	e.host.Do(func(doc *ydoc.Doc) { ok = readValue(doc, key, v) })
	return ok
}

func (e *env) changes() *roomChanges {
	var c roomChanges
	if !e.meta(metaChanges, &c) {
		return nil
	}
	return &c
}

func (e *env) commitFailure() *commitFailure {
	var f commitFailure
	if !e.meta(metaFailure, &f) {
		return nil
	}
	return &f
}

func (e *env) conflict() *roomConflict {
	var c roomConflict
	if !e.meta(metaConflict, &c) {
		return nil
	}
	return &c
}

// get requests a file of the room over HTTP.
func (e *env) get(path, token string) *httptest.ResponseRecorder {
	var segments []string
	for _, s := range strings.Split(path, "/") {
		segments = append(segments, url.PathEscape(s))
	}
	req := httptest.NewRequest(http.MethodGet, "/rooms/"+url.PathEscape(roomName)+"/files"+strings.Join(segments, "/"), nil)
	req.Header.Set("Authorization", "Bearer "+token)
	res := httptest.NewRecorder()
	e.x.ServeHTTP(res, req)
	return res
}

// webhook posts a push event for main.
func (e *env) webhook(secret string) *httptest.ResponseRecorder {
	body := `{"object_kind":"push","ref":"refs/heads/main","project_id":7,"project":{"id":7,"path_with_namespace":"` + projectPath + `"}}`
	req := httptest.NewRequest(http.MethodPost, "/gitlab/webhook", strings.NewReader(body))
	req.Header.Set("X-Gitlab-Token", secret)
	res := httptest.NewRecorder()
	e.x.ServeHTTP(res, req)
	return res
}

func ms(t time.Time) int64 { return t.UnixMilli() }

func TestLoading(t *testing.T) {
	t.Run("loads the branch into a new room: .typ files as text, other files by blob sha, the base in meta", func(t *testing.T) {
		e := setup(t, setupOptions{})
		require.Equal(t, []string{"/ch1.typ", mainTyp, "/old.typ"}, e.paths())
		require.Equal(t, mainText, e.text(mainTyp))
		require.Equal(t, map[string]any{"/img/logo.png": blobSha(logo)}, e.assets())
		b := e.base()
		require.Equal(t, e.repo.head("main").sha, b.Sha)
		require.Equal(t, mainText, b.Texts[mainTyp])
		require.Equal(t, map[string]string{"/img/logo.png": blobSha(logo)}, b.Assets)
		require.Nil(t, e.changes())
	})

	t.Run("loads a large tree", func(t *testing.T) { // its pages: api_test.go
		files := map[string]any{mainTyp: "main"}
		for i := range 150 {
			files["/data/"+string(rune('a'+i/26))+string(rune('a'+i%26))+".csv"] = "row"
		}
		e := setup(t, setupOptions{files: files})
		require.Len(t, e.assets(), 150)
	})

	t.Run("serves the other files over HTTP to holders of a room token, blobs cached by sha", func(t *testing.T) {
		e := setup(t, setupOptions{})
		res := e.get("/img/logo.png", "room-token")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "image/png", res.Header().Get("Content-Type"))
		require.Equal(t, "*", res.Header().Get("Access-Control-Allow-Origin"))
		require.Equal(t, logo, res.Body.Bytes())
		e.get("/img/logo.png", "room-token")
		require.Equal(t, 1, e.repo.count("blob "+blobSha(logo)))
		require.Equal(t, http.StatusUnauthorized, e.get("/img/logo.png", "wrong").Code)
		require.Equal(t, http.StatusNotFound, e.get("/missing.png", "room-token").Code)

		options := httptest.NewRequest(http.MethodOptions, "/rooms/x/files/a.png", nil)
		res = httptest.NewRecorder()
		e.x.ServeHTTP(res, options)
		require.Equal(t, http.StatusNoContent, res.Code)
		require.Equal(t, "Authorization", res.Header().Get("Access-Control-Allow-Headers"))
	})

	t.Run("a stored room opens with its own state and merges what was pushed meanwhile", func(t *testing.T) {
		first := setup(t, setupOptions{})
		first.edit(mainTyp, "= Report", "= Room report")
		var state []byte
		first.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		first.unload()

		first.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Third", "Last", 1)})
		again := setup(t, setupOptions{repo: first.repo, state: state})
		require.Equal(t, strings.Replace(strings.Replace(mainText, "= Report", "= Room report", 1), "Third", "Last", 1), again.text(mainTyp))
		require.Equal(t, first.repo.head("main").sha, again.base().Sha)
	})

	t.Run("a stored room opens when GitLab cannot be reached; a new one does not", func(t *testing.T) {
		first := setup(t, setupOptions{})
		first.edit(mainTyp, "First", "Opening")
		var state []byte
		first.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		first.unload()
		first.repo.unreachable = true
		again := setup(t, setupOptions{repo: first.repo, state: state})
		require.Equal(t, strings.Replace(mainText, "First", "Opening", 1), again.text(mainTyp))

		x := New(Options{repository: func(string) Repository { return first.repo }, Log: zerolog.Nop()})
		defer x.Close()
		host := &fakeHost{doc: ydoc.New()}
		_, err := x.openRoom(roomName, host, host.doc)
		require.ErrorIs(t, err, errUnreachable)
	})

	t.Run("leaves other rooms alone", func(t *testing.T) {
		x := New(Options{Log: zerolog.Nop()})
		defer x.Close()
		for _, name := range []string{"plain", "gitlab:", "gitlab:@main", "gitlab:p@", "github:p@main"} {
			r, err := x.openRoom(name, &fakeHost{}, ydoc.New())
			require.NoError(t, err)
			require.Nil(t, r, name)
			require.False(t, x.Handles(name), name)
		}
		require.True(t, x.Handles("gitlab:demo/report@main"))
		p, b, ok := x.parseRoomName("gitlab:7@feature/x@y")
		require.True(t, ok)
		require.Equal(t, []string{"7", "feature/x@y"}, []string{p, b})
	})
}

func TestSaving(t *testing.T) {
	t.Run("commits the changed files as one commit by the bot, names who saved, and moves the base", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		got := e.save("Reword the opening")
		head := e.repo.head("main")
		require.Equal(t, message{Type: msgSaved, Sha: head.sha, Author: "Ann"}, got)
		require.Equal(t, "Reword the opening", head.message, "nobody known edited: no co-authors")
		require.Equal(t, strings.Replace(mainText, "First", "Opening", 1), e.repo.texts()[mainTyp])
		require.Equal(t, head.sha, e.base().Sha)
		require.Equal(t, strings.Replace(mainText, "First", "Opening", 1), e.base().Texts[mainTyp])
		require.Equal(t, 1, e.repo.count("commit main"))
	})

	t.Run("has nothing to commit without changes, and a default message otherwise", func(t *testing.T) {
		e := setup(t, setupOptions{})
		require.Equal(t, message{Type: msgUnchanged}, e.save(""))
		e.edit(mainTyp, "First", "1st")
		e.save("  ")
		require.Equal(t, "Edit via Typst editor", e.repo.head("main").message)
	})

	t.Run("names who saves: the user, else whom the client names, else the editor", func(t *testing.T) {
		who, text, ok := parseSave(collab.User{Name: "Verified"}, `{"type":"gitlab:save","message":" Fix ","author":{"name":"Claimed"}}`)
		require.Equal(t, []any{"Verified", "Fix", true}, []any{who, text, ok})
		who, _, _ = parseSave(collab.User{}, `{"type":"gitlab:save"}`)
		require.Equal(t, "Typst editor", who)
		_, _, ok = parseSave(collab.User{}, `{"type":"other"}`)
		require.False(t, ok)
		_, _, ok = parseSave(collab.User{}, `not json`)
		require.False(t, ok)
	})

	t.Run("commits creates, renames and deletes made by a client", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { // what the widget's SharedProject does
			w.Delete(filesMap, "/ch1.typ")
			w.SetText(filesMap, "/chapter-1.typ", "= One\n\nText of one, edited.\n")
			w.Delete(filesMap, "/old.typ")
			w.SetText(filesMap, "/new.typ", "new\n")
		})
		require.Equal(t, msgSaved, e.save("").Type)
		require.Equal(t, 1, e.repo.count("commit main"))
		require.Equal(t, map[string]string{
			mainTyp: mainText, "/chapter-1.typ": "= One\n\nText of one, edited.\n", "/new.typ": "new\n", "/img/logo.png": string(logo),
		}, e.repo.texts())
	})

	t.Run("commits uploaded, renamed and deleted assets", func(t *testing.T) {
		e := setup(t, setupOptions{files: map[string]any{mainTyp: "main", "/a.png": logo, "/b.png": []byte{9}}})
		upload := []byte{1, 2, 3}
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) {
			w.Set(assetsMap, "/img/upload.png", upload)
			w.Set(assetsMap, "/renamed.png", doc.Values(assetsMap)["/a.png"])
			w.Delete(assetsMap, "/a.png")
			w.Delete(assetsMap, "/b.png")
		})
		require.Equal(t, upload, e.get("/img/upload.png", "room-token").Body.Bytes())
		require.Equal(t, msgSaved, e.save("").Type)
		files := e.repo.head("main").files
		require.Equal(t, []string{"/img/upload.png", mainTyp, "/renamed.png"}, slices.Sorted(maps.Keys(files)))
		require.Equal(t, upload, files["/img/upload.png"])
		require.Equal(t, blobSha(upload), e.assets()["/img/upload.png"], "the upload is a repository file now")
		require.Equal(t, map[string]string{"/img/upload.png": blobSha(upload), "/renamed.png": blobSha(logo)}, e.base().Assets)
		require.Equal(t, upload, e.get("/img/upload.png", "room-token").Body.Bytes(), "from the cache")
		require.Zero(t, e.repo.count("blob "+blobSha(upload)))
	})
}

func TestUpstreamChanges(t *testing.T) {
	t.Run("merges an upstream commit into the room and commits on top of it", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		e.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Third", "Last", 1), "/ch2.typ": "two"})
		got := e.save("")
		require.Equal(t, message{Type: msgSaved, Sha: e.repo.head("main").sha, Author: "Ann"}, got)
		both := strings.Replace(strings.Replace(mainText, "First", "Opening", 1), "Third", "Last", 1)
		require.Equal(t, both, e.repo.texts()[mainTyp])
		require.Equal(t, both, e.text(mainTyp))
		require.Equal(t, "two", e.text("/ch2.typ"))
	})

	t.Run("applies upstream as small edits, so text around them keeps its identity", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		// a client that has the room and edits concurrently with the merge, its edit anchored in the text
		var state []byte
		e.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		client, err := ydoc.Load(state)
		require.NoError(t, err)
		require.NoError(t, client.Write(nil, func(w *ydoc.Writer) { replace(t, w, client, mainTyp, "Second paragraph", "Second, long paragraph") }))

		e.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Third", "Last", 1)})
		require.Equal(t, http.StatusAccepted, e.webhook("hook-secret").Code)
		e.host.Do(func(doc *ydoc.Doc) {
			require.NoError(t, doc.Apply(client.State(), nil))
			require.NoError(t, client.Apply(doc.State(), nil))
		})
		want := strings.NewReplacer("First", "Opening", "Second paragraph", "Second, long paragraph", "Third", "Last").Replace(mainText)
		require.Equal(t, want, e.text(mainTyp))
		require.Equal(t, want, client.Texts(filesMap)[mainTyp])
	})

	t.Run("merges a push reported by the webhook and tells the clients", func(t *testing.T) {
		e := setup(t, setupOptions{})
		sha := e.repo.push("main", map[string]any{"/ch1.typ": "pushed"})
		res := e.webhook("hook-secret")
		require.Equal(t, http.StatusAccepted, res.Code)
		require.Equal(t, "Accepted", res.Body.String())
		require.Equal(t, "pushed", e.text("/ch1.typ"))
		require.Equal(t, sha, e.base().Sha)
		require.Equal(t, []message{{Type: msgMerged, Sha: sha}}, e.host.takeSent())

		require.Equal(t, http.StatusUnauthorized, e.webhook("wrong").Code)
		require.Equal(t, http.StatusAccepted, e.webhook("hook-secret").Code, "nothing new")
		require.Empty(t, e.host.takeSent())
		for body, code := range map[string]int{
			`{"object_kind":"tag_push","ref":"refs/tags/v1","project_id":7}`: http.StatusAccepted,
			`{"object_kind":"push","ref":"refs/heads/other","project_id":7}`: http.StatusAccepted,
			`not json`: http.StatusBadRequest,
		} {
			req := httptest.NewRequest(http.MethodPost, "/gitlab/webhook", strings.NewReader(body))
			req.Header.Set("X-Gitlab-Token", "hook-secret")
			res := httptest.NewRecorder()
			e.x.ServeHTTP(res, req)
			require.Equal(t, code, res.Code, body)
		}
		res = httptest.NewRecorder()
		e.x.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/gitlab/webhook", nil))
		require.Equal(t, http.StatusMethodNotAllowed, res.Code)
	})

	t.Run("retries when a push lands between its check and its commit", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		e.repo.failNext = &failure{push: map[string]any{mainTyp: strings.Replace(mainText, "Second", "2nd", 1)}}
		require.Equal(t, msgSaved, e.save("").Type)
		require.Equal(t, strings.Replace(strings.Replace(mainText, "First", "Opening", 1), "Second", "2nd", 1), e.repo.texts()[mainTyp])
		require.Equal(t, e.repo.texts()[mainTyp], e.text(mainTyp))
	})

	t.Run("takes in a push to another file that landed under its commit", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		e.repo.failNext = &failure{push: map[string]any{"/ch1.typ": "pushed"}, under: true}
		require.Equal(t, msgSaved, e.save("").Type)
		require.Equal(t, "pushed", e.text("/ch1.typ"))
		require.Equal(t, e.repo.head("main").sha, e.base().Sha)
		require.Equal(t, "pushed", e.base().Texts["/ch1.typ"])
	})

	t.Run("reports a true conflict to the clients and keeps the room and the branch as they are", func(t *testing.T) {
		e := setup(t, setupOptions{})
		before := e.repo.head("main").sha
		e.edit(mainTyp, "Second paragraph.", "Mine.")
		upstream := e.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Second paragraph.", "Theirs.", 1)})
		mine := strings.Replace(mainText, "Second paragraph.", "Mine.", 1)
		from := strings.Index(mine, "Mine.")
		require.Equal(t, message{Type: msgConflict, Sha: upstream, Files: []fileConflict{{Path: mainTyp, Ranges: []conflictRange{{From: from, To: from + len("Mine.\n")}}}}}, e.save(""))
		require.Equal(t, mine, e.text(mainTyp))
		require.Equal(t, upstream, e.repo.head("main").sha)
		require.Equal(t, before, e.base().Sha)
		require.Equal(t, &roomConflict{Sha: upstream, Paths: []string{mainTyp}}, e.conflict())
	})
}

func TestWhatIsNotInGitLabYet(t *testing.T) {
	t.Run("tells the room which files changed, since when and by whom, shortly after the edits", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		require.Nil(t, e.changes())
		e.clock.Advance(500 * time.Millisecond)
		require.Equal(t, &roomChanges{Files: []changedFile{{mainTyp, "modified"}}, Since: ms(atTen), Editors: []string{"Ann"}}, e.changes())

		e.clock.Advance(time.Minute)
		e.editAs(bob, func(w *ydoc.Writer, _ *ydoc.Doc) {
			w.Delete(filesMap, "/old.typ")
			w.SetText(filesMap, "/new.typ", "new\n")
			w.Set(assetsMap, "/img/upload.png", []byte{1})
		})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Opening", "Start") })
		e.clock.Advance(500 * time.Millisecond)
		require.Equal(t, &roomChanges{
			Files: []changedFile{{"/img/upload.png", "added"}, {mainTyp, "modified"}, {"/new.typ", "added"}, {"/old.typ", "deleted"}},
			Since: ms(atTen), Editors: []string{"Ann", "Bob"},
		}, e.changes())

		require.Equal(t, msgSaved, e.save("").Type)
		require.Nil(t, e.changes())
	})

	t.Run("is clean again when the edits are undone, and starts over with the next edit", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.clock.Advance(500 * time.Millisecond)
		e.editAs(bob, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Opening", "First") })
		e.clock.Advance(500 * time.Millisecond)
		require.Nil(t, e.changes())
		e.clock.Advance(time.Minute)
		e.editAs(bob, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "1st") })
		e.clock.Advance(500 * time.Millisecond)
		c := e.changes()
		require.Equal(t, ms(atTen)+61_000, c.Since)
		require.Equal(t, []string{"Bob"}, c.Editors)
	})

	t.Run("counts edits by clients without a name as by nobody", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(cleo, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.editAs(&testClient{}, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Second", "2nd") })
		e.clock.Advance(500 * time.Millisecond)
		require.Equal(t, []string{"Cleo"}, e.changes().Editors)
	})

	t.Run("names the editors as co-authors of a save", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(bob, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.editAs(cleo, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Second", "2nd") })
		e.save("Reword")
		require.Equal(t, "Reword\n\nCo-authored-by: Bob <bob@example.com>\nCo-authored-by: Cleo <cleo@example.com>", e.repo.head("main").message)
	})

	t.Run("keeps the editors when a commit fails", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.repo.failNext = &failure{err: &APIError{Status: 500, Message: "down"}}
		require.Equal(t, message{Type: msgError, Message: "down"}, e.save(""))
		c := e.changes()
		require.Equal(t, ms(atTen), c.Since)
		require.Equal(t, []string{"Ann"}, c.Editors)
		e.save("")
		require.Equal(t, "Edit via Typst editor\n\nCo-authored-by: Ann <ann@example.com>", e.repo.head("main").message)
	})

	t.Run("knows the editors of a stored room by name", func(t *testing.T) {
		first := setup(t, setupOptions{})
		first.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		first.clock.Advance(500 * time.Millisecond)
		var state []byte
		first.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		first.unload()
		again := setup(t, setupOptions{repo: first.repo, state: state})
		require.Equal(t, []string{"Ann"}, again.changes().Editors)
		again.save("")
		require.Equal(t, "Edit via Typst editor\n\nCo-authored-by: Ann <typst-editor@localhost>", again.repo.head("main").message)
	})
}

func TestAutoCommit(t *testing.T) {
	t.Run("commits on the branch itself after the room was idle: named after who edited most, the editors as co-authors", func(t *testing.T) {
		e := setup(t, setupOptions{autoCommit: 10 * time.Minute})
		var minutes float64
		require.True(t, e.meta(metaAutoCommit, &minutes))
		require.Equal(t, 10.0, minutes)
		parent := e.repo.head("main").sha
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.editAs(bob, func(w *ydoc.Writer, _ *ydoc.Doc) { w.SetText(filesMap, "/chapters/new.typ", "new\n") })
		e.clock.Advance(9 * time.Minute)
		e.editAs(bob, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, "/chapters/new.typ", "new", "newer") })
		e.clock.Advance(9 * time.Minute)
		require.Equal(t, parent, e.repo.head("main").sha)

		e.clock.Advance(time.Minute)
		head := e.repo.head("main")
		require.Equal(t, parent, head.parent)
		require.Equal(t, "Edits by Ann, Bob: chapters/new.typ, main.typ\n\nCo-authored-by: Ann <ann@example.com>\nCo-authored-by: Bob <bob@example.com>", head.message)
		require.Equal(t, "newer\n", e.repo.texts()["/chapters/new.typ"])
		require.Equal(t, []message{{Type: msgSaved, Sha: head.sha, Author: "Bob", Automatic: true}}, e.host.takeSent())
		require.Nil(t, e.changes())
	})

	t.Run("names at most three files in the message", func(t *testing.T) {
		e := setup(t, setupOptions{autoCommit: time.Minute})
		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) {
			for _, name := range []string{"a", "b", "c", "d", "e"} {
				w.SetText(filesMap, "/"+name+".typ", name)
			}
		})
		e.clock.Advance(time.Minute)
		require.Equal(t, "Edits by Ann: a.typ, b.typ, c.typ and 2 more\n\nCo-authored-by: Ann <ann@example.com>", e.repo.head("main").message)
	})

	t.Run("commits a little while after the last user left, unless someone is back by then", func(t *testing.T) {
		e := setup(t, setupOptions{autoCommit: 10 * time.Minute})
		parent := e.repo.head("main").sha
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.host.setEmpty(true)
		left := e.left()
		e.clock.Advance(LeaveDelay - time.Second)
		e.host.setEmpty(false) // back before the delay is over (a reload): no commit
		e.clock.Advance(2 * time.Second)
		<-left
		require.Equal(t, parent, e.repo.head("main").sha)

		e.host.setEmpty(true)
		left = e.left()
		e.clock.Advance(LeaveDelay)
		<-left
		require.Equal(t, "Edits by Ann: main.typ\n\nCo-authored-by: Ann <ann@example.com>", e.repo.head("main").message)
	})

	t.Run("never commits by itself when off", func(t *testing.T) {
		e := setup(t, setupOptions{})
		var minutes *float64
		require.False(t, e.meta(metaAutoCommit, &minutes), "null")
		parent := e.repo.head("main").sha
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.clock.Advance(time.Hour)
		e.host.setEmpty(true)
		<-e.left()
		e.clock.Advance(LeaveDelay)
		require.Equal(t, parent, e.repo.head("main").sha)
	})

	t.Run("is blocked by a conflict, which stays in the room until a merge succeeds", func(t *testing.T) {
		e := setup(t, setupOptions{autoCommit: 10 * time.Minute})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "Second paragraph.", "Mine.") })
		upstream := e.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Second paragraph.", "Theirs.", 1)})
		e.clock.Advance(10 * time.Minute)
		sent := e.host.takeSent()
		require.Len(t, sent, 1)
		require.Equal(t, msgConflict, sent[0].Type)
		require.Equal(t, upstream, sent[0].Sha)
		require.Equal(t, &roomConflict{Sha: upstream, Paths: []string{mainTyp}}, e.conflict())
		require.Equal(t, upstream, e.repo.head("main").sha)
		require.Equal(t, []changedFile{{mainTyp, "modified"}}, e.changes().Files)

		// the lines are made to match: the next idle commit merges and commits the rest
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) {
			replace(t, w, doc, mainTyp, "Mine.", "Theirs.")
		})
		e.editAs(ann, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
		e.clock.Advance(10 * time.Minute)
		require.Nil(t, e.conflict())
		sent = e.host.takeSent()
		require.Len(t, sent, 1)
		require.Equal(t, msgSaved, sent[0].Type)
		require.True(t, sent[0].Automatic)
		require.Equal(t, strings.Replace(strings.Replace(mainText, "Second paragraph.", "Theirs.", 1), "First", "Opening", 1), e.repo.texts()[mainTyp])
	})

	t.Run("reads its setting", func(t *testing.T) {
		for value, want := range map[string]time.Duration{"": DefaultAutoCommit, " ": DefaultAutoCommit, "off": 0, "OFF": 0, "false": 0, "0": 0, "5": 5 * time.Minute, "0.5": 30 * time.Second} {
			got, err := ParseAutoCommit(value)
			require.NoError(t, err, value)
			require.Equal(t, want, got, value)
		}
		for _, value := range []string{"soon", "-1", "NaN"} {
			_, err := ParseAutoCommit(value)
			require.ErrorContains(t, err, "TYPST_GITLAB_AUTO_COMMIT", value)
		}
	})
}

// left runs Left as the collaboration server does when the last client left, and waits until it waits for
// the leave delay (or has returned); the channel closes when it returns.
func (e *env) left() <-chan struct{} {
	done := make(chan struct{})
	go func() { defer close(done); e.room.Left(context.Background()) }()
	require.Eventually(e.t, func() bool {
		select {
		case <-done:
			return true
		default:
			return e.clock.pending(LeaveDelay)
		}
	}, 5*time.Second, time.Millisecond)
	return done
}

func TestFailedCommits(t *testing.T) {
	t.Run("keeps a save that could not reach GitLab in the room, for everyone, until the next commit", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		e.repo.unreachable = true
		const text = "GitLab could not be reached (fetch failed)"
		require.Equal(t, message{Type: msgError, Message: text}, e.save(""))
		require.Equal(t, &commitFailure{Message: text, At: ms(atTen)}, e.commitFailure())
		// who joins later gets it with the room
		var state []byte
		e.host.Do(func(doc *ydoc.Doc) { state = doc.State() })
		later, err := ydoc.Load(state)
		require.NoError(t, err)
		var failure commitFailure
		require.True(t, readValue(later, metaFailure, &failure))
		require.Equal(t, text, failure.Message)

		e.repo.unreachable = false
		require.Equal(t, msgSaved, e.save("").Type)
		require.Nil(t, e.commitFailure())
	})

	t.Run("tells everyone when a commit by itself fails; a merge clears it", func(t *testing.T) {
		e := setup(t, setupOptions{autoCommit: 10 * time.Minute})
		e.editAs(ann, func(w *ydoc.Writer, _ *ydoc.Doc) { w.Edit(filesMap, mainTyp, 0, 0, "Hello. ") })
		e.repo.failNext = &failure{err: &APIError{Status: 500, Message: "down for maintenance"}}
		e.clock.Advance(10 * time.Minute)
		require.Equal(t, []message{{Type: msgError, Message: "down for maintenance"}}, e.host.takeSent())
		require.Equal(t, &commitFailure{Message: "down for maintenance", At: ms(atTen.Add(10 * time.Minute))}, e.commitFailure())

		e.repo.push("main", map[string]any{"/ch1.typ": "pushed"})
		e.webhook("hook-secret")
		require.Nil(t, e.commitFailure())
	})

	t.Run("gives way to a conflict: GitLab answered, the conflict is what blocks the commit now", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "Second paragraph.", "Mine.")
		e.repo.unreachable = true
		e.save("")
		require.NotNil(t, e.commitFailure())
		e.repo.unreachable = false
		e.repo.push("main", map[string]any{mainTyp: strings.Replace(mainText, "Second paragraph.", "Theirs.", 1)})
		require.Equal(t, msgConflict, e.save("").Type)
		require.Nil(t, e.commitFailure())
		require.NotNil(t, e.conflict())
	})

	t.Run("gives up when the branch keeps moving", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.edit(mainTyp, "First", "Opening")
		e.repo.alwaysMove = true
		require.Equal(t, message{Type: msgError, Message: "The branch keeps changing; try again."}, e.save(""))
		require.Equal(t, 3, e.repo.count("commit main"))
	})
}
