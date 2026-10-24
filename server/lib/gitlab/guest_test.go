package gitlab

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// guestClient is a guest's client (package guest): it edits, never saves; refused are the reasons the room
// refused it for (as collab.Peer's Refuse).
type guestClient struct {
	name, id string
	refused  []string
}

func (c *guestClient) Name() string { return c.name }
func (c *guestClient) User() collab.User {
	return collab.User{Provider: collab.GuestProvider, ID: c.id, Name: c.name}
}
func (c *guestClient) Refuse(reason string) { c.refused = append(c.refused, reason) }

var jane = &guestClient{name: "Jane (guest)", id: "share1/abc"}

func TestGuestsChangeOnlyTheFilesGuestsMayChange(t *testing.T) {
	files := initialFiles()
	files["/.gitlab-ci.yml"] = []byte("stages: [build]\n")
	e := setup(t, setupOptions{files: files})
	var editable []string
	require.True(t, e.meta(metaGuestEditable, &editable))
	require.Equal(t, []string{".typ", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".mmd", ".ic"}, editable, "the clients' list")

	guest := &guestClient{name: "Jane (guest)", id: "share1/abc"}
	e.editAs(guest, func(w *ydoc.Writer, doc *ydoc.Doc) {
		replace(t, w, doc, mainTyp, "First", "Opening")
		w.Set(assetsMap, "/img/new.PNG", []byte{1, 2})
		w.Set(assetsMap, "/flow.mmd", []byte("graph TD"))
		w.Delete(assetsMap, "/img/logo.png")
	})
	require.Empty(t, guest.refused, "Typst files, images and diagrams are theirs to change")
	require.Contains(t, e.text(mainTyp), "Opening")

	// a member's change is what stays
	ci := []byte("stages: [build, test]\n")
	e.editAs(bob, func(w *ydoc.Writer, doc *ydoc.Doc) {
		w.Set(assetsMap, "/.gitlab-ci.yml", ci)
		replace(t, w, doc, "/ch1.typ", "Text", "Words")
	})
	attempts := []struct {
		name   string
		change func(w *ydoc.Writer)
	}{
		{"edit", func(w *ydoc.Writer) { w.Set(assetsMap, "/.gitlab-ci.yml", []byte("stages: [deploy]\n")) }},
		{"delete", func(w *ydoc.Writer) { w.Delete(assetsMap, "/.gitlab-ci.yml") }},
		{"rename", func(w *ydoc.Writer) { w.Delete(assetsMap, "/.gitlab-ci.yml"); w.Set(assetsMap, "/ci.yml", ci) }},
		{"create", func(w *ydoc.Writer) { w.Set(assetsMap, "/refs.bib", []byte("@book{x}")) }},
		{"create as text", func(w *ydoc.Writer) { w.SetText(filesMap, "/notes.md", "# Notes") }},
		{"meta", func(w *ydoc.Writer) { w.Set(metaMap, metaGuestEditable, []any{".yml"}) }},
	}
	for i, attempt := range attempts {
		guest := &guestClient{name: "Jane (guest)", id: "share1/abc"}
		e.editAs(guest, func(w *ydoc.Writer, doc *ydoc.Doc) {
			replace(t, w, doc, mainTyp, "Second", fmt.Sprintf("Second %d", i))
			attempt.change(w)
		})
		require.Equal(t, []string{guestRefused}, guest.refused, attempt.name)
		require.Equal(t, ci, e.assets()["/.gitlab-ci.yml"], attempt.name)
		for _, p := range []string{"/ci.yml", "/refs.bib"} {
			require.NotContains(t, e.assets(), p, attempt.name)
		}
		require.NotContains(t, e.paths(), "/notes.md", attempt.name)
		require.True(t, e.meta(metaGuestEditable, &editable))
		require.Equal(t, guestEditable, editable, attempt.name)
		require.Contains(t, e.text(mainTyp), fmt.Sprintf("Second %d", i), "%s: their Typst edit of the same change stays", attempt.name)
		require.Contains(t, e.text("/ch1.typ"), "Words", "%s: the member's edit stays", attempt.name)
	}

	require.Equal(t, msgSaved, e.save("Reviewed").Type)
	head := e.repo.head("main").files
	require.Equal(t, ci, head["/.gitlab-ci.yml"], "the member's version, none of the guest's")
	for _, p := range []string{"/ci.yml", "/refs.bib", "/notes.md"} {
		require.NotContains(t, head, p)
	}
	require.Contains(t, string(head[mainTyp]), "Opening")
	require.Equal(t, []byte("graph TD"), head["/flow.mmd"])
	require.NotContains(t, head, "/img/logo.png")
}

// In the collaboration server, the guest's client is refused (PermissionDenied) and everyone has the file back.
func TestAGuestWhoChangesAnotherFileIsRefused(t *testing.T) {
	files := initialFiles()
	files["/.gitlab-ci.yml"] = []byte("stages: [build]\n")
	repo := newFakeRepo(files)
	x := New(Options{Log: zerolog.Nop(), Token: (&fakeTokens{}).Token, repository: func(string) Repository { return repo }, access: repo.Access})
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	authenticate := func(r *http.Request, room string) (collab.User, error) {
		c, _ := r.Cookie("session")
		if c.Value == "guest" {
			return jane.User(), nil
		}
		user := collab.User{Provider: DefaultID, ID: c.Value}
		return user, x.Authorize(r.Context(), user, room)
	}
	s := collab.New(collab.Options{Store: st, Authenticate: authenticate, Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
	defer x.Close()
	defer func() { require.NoError(t, s.Close(context.Background())) }()

	sha := blobSha(files["/.gitlab-ci.yml"].([]byte))
	a := join(t, s, "7")
	a.eventually("a has the branch", func() bool { return a.doc.Values(assetsMap)["/.gitlab-ci.yml"] == sha })
	g := join(t, s, "guest")
	g.eventually("the guest has the branch", func() bool { return g.doc.Values(assetsMap)["/.gitlab-ci.yml"] == sha })
	g.edit(func(w *ydoc.Writer, _ *ydoc.Doc) { w.Set(assetsMap, "/.gitlab-ci.yml", []byte("stages: [deploy]\n")) })
	g.eventually("the guest is refused", func() bool { return g.denied != "" })
	require.Equal(t, guestRefused, g.denied)
	a.eventually("a has the file back", func() bool { return a.doc.Values(assetsMap)["/.gitlab-ci.yml"] == sha })
}

func TestGuestsEditAndMembersSave(t *testing.T) {
	e := setup(t, setupOptions{autoCommit: 10 * time.Minute})
	parent := e.repo.head("main").sha
	ctx := context.Background()
	require.EqualError(t, e.x.mayPush(ctx, jane.User(), projectPath, "main"), "Guests cannot save; a member saves your edits.")

	e.editAs(jane, func(w *ydoc.Writer, doc *ydoc.Doc) { replace(t, w, doc, mainTyp, "First", "Opening") })
	e.clock.Advance(10 * time.Minute)
	require.Equal(t, parent, e.repo.head("main").sha, "never by itself")
	require.Equal(t, []string{"Jane (guest)"}, e.changes().Editors)
	require.Equal(t, []string{""}, e.changes().EditorIDs, "a guest is no GitLab user")
	require.Equal(t, []message{{Type: msgError, Message: "Guest edits: a member must save."}}, e.host.takeSent())
	require.Equal(t, "Guest edits: a member must save.", e.commitFailure().Message)

	require.Equal(t, msgSaved, e.save("Reviewed").Type)
	require.Equal(t, "Reviewed\n\nCo-authored-by: Jane (guest) <zwiebelfisch@localhost>", e.repo.head("main").message,
		"the guest as a co-author, never with an email of their own")
}

func TestMayEdit(t *testing.T) {
	repo := newFakeRepo(initialFiles())
	tokens := &fakeTokens{}
	x := New(Options{Log: zerolog.Nop(), Token: tokens.Token, repository: func(string) Repository { return repo }, access: repo.Access, clock: &fakeClock{now: atTen}})
	defer x.Close()
	ctx := context.Background()
	user := func(id string) collab.User { return collab.User{Provider: DefaultID, ID: id} }

	may, err := x.MayEdit(ctx, user("7"), roomName)
	require.NoError(t, err)
	require.True(t, may)
	repo.setAccess("9", Access{Role: "Reporter"})
	may, err = x.MayEdit(ctx, user("9"), roomName)
	require.NoError(t, err)
	require.False(t, may)
	may, err = x.MayEdit(ctx, jane.User(), roomName)
	require.NoError(t, err)
	require.False(t, may, "a guest")
	tokens.signOut("11")
	_, err = x.MayEdit(ctx, user("11"), roomName)
	require.Error(t, err, "signed out, and nobody else to ask: cannot be told")
	may, err = x.MayEdit(ctx, user("7"), "plain")
	require.NoError(t, err)
	require.False(t, may)
}

func TestMayEditAsksAboutASignedOutUserWithAMembersToken(t *testing.T) {
	repo := newFakeRepo(initialFiles())
	tokens := &fakeTokens{}
	signedIn := []string{"11", "13", "12"}
	x := New(Options{
		Log: zerolog.Nop(), Token: tokens.Token, SignedIn: func() []string { return signedIn },
		repository: func(string) Repository { return repo }, access: repo.Access, clock: &fakeClock{now: atTen},
	})
	defer x.Close()
	ctx := context.Background()
	ann := collab.User{Provider: DefaultID, ID: "11"}
	tokens.signOut("11")
	repo.setAccess("13", Access{}) // signed in, but no member: never asks
	repo.usedTokens()

	may, err := x.MayEdit(ctx, ann, roomName)
	require.NoError(t, err)
	require.True(t, may)
	require.Equal(t, []string{"token-12", "token-12"}, repo.usedTokens()[1:], "after 13's own, 12 asks of itself, then of Ann")

	repo.setAccess("11", Access{})
	may, err = x.MayEdit(ctx, ann, roomName)
	require.NoError(t, err)
	require.False(t, may, "removed from the project")

	signedIn = []string{"11"}
	_, err = x.MayEdit(ctx, ann, roomName)
	require.ErrorIs(t, err, errSignedOut, "nobody else signed in")
}

func TestAGuestPullsNothingIn(t *testing.T) {
	fake := fakegitlab.New("group/report", fakegitlab.Files{
		"/reports/q1/main.typ": []byte(`#import "/template.typ": report`), "/template.typ": []byte(templateText), "/main.typ": []byte(mainText),
	})
	ann := fake.SetAccess("Ann", fakegitlab.Developer)
	x := New(Options{
		URL: fakegitlab.URL, Client: fake.Client(), Log: zerolog.Nop(),
		Token: func(context.Context, string) (string, error) { return fake.TokenOf("Ann"), nil },
	})
	st, err := store.Open(store.Memory)
	require.NoError(t, err)
	defer st.Close()
	authenticate := func(r *http.Request, room string) (collab.User, error) {
		if c, _ := r.Cookie("session"); c != nil && c.Value == "guest" {
			return jane.User(), nil
		}
		user := collab.User{Provider: DefaultID, ID: fmt.Sprint(ann.ID), Name: "Ann"}
		return user, x.Authorize(r.Context(), user, room)
	}
	s := collab.New(collab.Options{Store: st, Authenticate: authenticate, Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
	defer x.Close()
	defer func() { require.NoError(t, s.Close(context.Background())) }()

	a := joinRoom(t, s, fmt.Sprint(ann.ID), folderRoom)
	a.eventually("a has the folder", func() bool { return a.doc.Texts(filesMap)[q1Main] != "" })
	g := joinRoom(t, s, "guest", folderRoom)
	g.eventually("the guest has the folder", func() bool { return g.doc.Texts(filesMap)[q1Main] != "" })
	g.send(msgTypeStateless, varString(`{"type":"gitlab:pull","path":"/template.typ"}`))
	g.eventually("the guest is told", func() bool { return len(g.stateless) == 1 })
	require.Equal(t, msgMissing, g.stateless[0].Type)
	require.Equal(t, "A guest cannot load files from outside the project folder; a member who opens the project can.", g.stateless[0].Message)
	require.NotContains(t, a.doc.Texts(filesMap), "/template.typ")

	g.send(msgTypeStateless, varString(`{"type":"gitlab:save","message":"mine"}`))
	g.eventually("the save is refused", func() bool { return len(g.stateless) == 2 })
	require.Equal(t, message{Type: msgError, Message: "Guests cannot save; a member saves your edits."}, g.stateless[1])
}

func TestAGuestSeesTheHistoryWithoutEmails(t *testing.T) {
	e := setup(t, setupOptions{})
	e.x.opts.Authenticate = func(r *http.Request, room string) (collab.User, error) {
		if c, _ := r.Cookie("session"); c != nil && c.Value == "guest" {
			return jane.User(), nil
		}
		return signedIn(r, room)
	}
	message := "Edits by Ann, Bob: ch1.typ\n\nCo-authored-by: Bob <bob@example.com>\nSigned-off-by: Ann <ann@example.com>"
	e.repo.pushWith("main", map[string]any{"/ch1.typ": "= One, again\n"}, message, Signature{"Ann", "ann@example.com"})
	e.room.pullWith(t.Context(), "token")

	historyAs := func(session string) historyCommit {
		res := e.request("history", session)
		require.Equal(t, http.StatusOK, res.Code)
		var page historyPage
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &page))
		return page.Commits[0]
	}
	require.Equal(t, message, historyAs("ann").Message)
	commit := historyAs("guest")
	require.Equal(t, "Edits by Ann, Bob: ch1.typ\n\nCo-authored-by: Bob\nSigned-off-by: Ann", commit.Message)
	require.Equal(t, []string{"Ann", "Bob"}, commit.People)
}
