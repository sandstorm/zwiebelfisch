package gitlab

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/store"
)

// The start page's view of GitLab: projects, branches, project folders and templates, and a new folder
// from a template, against the fake GitLab.

func TestProjectFolders(t *testing.T) {
	entries := []TreeEntry{
		{Path: "/main.typ"}, {Path: "/2026/q1/main.typ"}, {Path: "/2026/q1/img/a.png"}, {Path: "/2026/q2/notes.typ"},
		{Path: "/_drafts/x/main.typ"}, {Path: "/2026/_template/main.typ"}, {Path: "/2026/_template/logo.png"},
		{Path: "/_templates/report/main.typ"}, {Path: "/_templates/letter/main.typ"}, {Path: "/_templates/README.md"},
		{Path: "/_template/main.typ"},
	}
	require.Equal(t, Folders{
		Folders: []string{"/", "/2026/q1"},
		Templates: []Template{
			{Name: "2026", Path: "/2026/_template", Scope: "/2026"},
			{Name: "Template", Path: "/_template", Scope: "/"},
			{Name: "letter", Path: "/_templates/letter", Scope: "/"},
			{Name: "report", Path: "/_templates/report", Scope: "/"},
		},
	}, projectFolders(entries))
	require.Equal(t, Folders{Folders: nil, Templates: []Template{}}, projectFolders(nil))
}

func TestBrowseAgainstTheFakeGitLab(t *testing.T) {
	fake := fakegitlab.New("group/report", fakegitlab.Files{
		"/2026/q1/main.typ": []byte("= Q1"), "/main.typ": []byte(mainText),
		"/2026/_template/main.typ": []byte(`#import "/template.typ": report` + "\n= New report\n"),
		"/2026/_template/logo.png": {1, 2, 3}, "/_templates/letter/main.typ": []byte("= Letter"),
	})
	annUser := fake.SetAccess("Ann", fakegitlab.Developer)
	bob := fake.SetAccess("Bob", fakegitlab.Reporter)
	tokens := map[string]string{fmt.Sprint(annUser.ID): fake.TokenOf("Ann"), fmt.Sprint(bob.ID): fake.TokenOf("Bob")}
	x := New(Options{
		URL: fakegitlab.URL, Client: fake.Client(), AutoCommit: time.Hour, Log: zerolog.Nop(),
		Token: func(_ context.Context, user string) (string, error) { return tokens[user], nil },
	})
	defer x.Close()
	ann := collab.User{Provider: DefaultID, ID: fmt.Sprint(annUser.ID), Name: "Ann"}

	call := func(handler func(http.ResponseWriter, *http.Request, collab.User), user collab.User, method, target string, body any) *httptest.ResponseRecorder {
		var payload bytes.Buffer
		if body != nil {
			require.NoError(t, json.NewEncoder(&payload).Encode(body))
		}
		req := httptest.NewRequest(method, target, &payload)
		req.SetPathValue("project", "group/report")
		res := httptest.NewRecorder()
		handler(res, req, user)
		return res
	}
	decode := func(res *httptest.ResponseRecorder, v any) {
		require.Equal(t, http.StatusOK, res.Code, res.Body.String())
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), v))
	}

	t.Run("projects the user may edit, matching the search", func(t *testing.T) {
		var projects []Project
		decode(call(x.ServeProjects, ann, "GET", "/?search=rep", nil), &projects)
		require.Equal(t, []Project{{Path: "group/report", Name: "group / report"}}, projects)
		decode(call(x.ServeProjects, ann, "GET", "/?search=nothing", nil), &projects)
		require.Empty(t, projects)
	})

	t.Run("branches, and the default one", func(t *testing.T) {
		var branches struct {
			Default  string   `json:"default"`
			Branches []string `json:"branches"`
		}
		decode(call(x.ServeBranches, ann, "GET", "/", nil), &branches)
		require.Equal(t, "main", branches.Default)
		require.Equal(t, []string{"main"}, branches.Branches)
	})

	t.Run("project folders and templates of a branch", func(t *testing.T) {
		var folders Folders
		decode(call(x.ServeFolders, ann, "GET", "/?ref=main", nil), &folders)
		require.Equal(t, []string{"/", "/2026/q1"}, folders.Folders)
		require.Equal(t, []Template{
			{Name: "2026", Path: "/2026/_template", Scope: "/2026"},
			{Name: "letter", Path: "/_templates/letter", Scope: "/"},
		}, folders.Templates)
		require.Equal(t, http.StatusBadRequest, call(x.ServeFolders, ann, "GET", "/", nil).Code)
		require.Equal(t, http.StatusNotFound, call(x.ServeFolders, ann, "GET", "/?ref=nope", nil).Code)
	})

	t.Run("refuses a new folder that exists, a template that does not serve it, a bad path, a Reporter", func(t *testing.T) {
		for _, c := range []struct {
			user           collab.User
			path, template string
			status         int
			why            string
		}{
			{ann, "/2026/q1", "", http.StatusBadRequest, "/2026/q1 exists already: open it instead"},
			{ann, "/2027/q1", "/2026/_template", http.StatusBadRequest, "/2026/_template is no template for /2027/q1"},
			{ann, "/2026x/q1", "/2026/_template", http.StatusBadRequest, "/2026/_template is no template for /2026x/q1"},
			{ann, "/2026/q3", "/2026/q1", http.StatusBadRequest, "/2026/q1 is no template for /2026/q3"},
			{ann, "2026/q3", "", http.StatusBadRequest, `"2026/q3" is no folder a project can be in (e.g. /2026/q3).`},
			{ann, "/2026/../x", "", http.StatusBadRequest, `"/2026/../x" is no folder a project can be in (e.g. /2026/q3).`},
			{collab.User{Provider: DefaultID, ID: fmt.Sprint(bob.ID)}, "/2026/q3", "", http.StatusForbidden, "Editing group/report needs the Developer role on GitLab; you are Reporter."},
		} {
			res := call(x.ServeNewFolder, c.user, "POST", "/", map[string]string{"ref": "main", "path": c.path, "template": c.template})
			require.Equal(t, c.status, res.Code, c.path)
			require.Equal(t, c.why+"\n", res.Body.String(), c.path)
		}
	})

	t.Run("a new folder's room starts with the template's files as changes; a save commits them", func(t *testing.T) {
		var created struct{ Room string }
		decode(call(x.ServeNewFolder, ann, "POST", "/", map[string]string{"ref": "main", "path": "/2026/q3", "template": "/2026/_template"}), &created)
		require.Equal(t, "gitlab:group/report@main:/2026/q3", created.Room)

		st, err := store.Open(store.Memory)
		require.NoError(t, err)
		defer st.Close()
		authenticate := func(r *http.Request, room string) (collab.User, error) {
			return ann, x.Authorize(r.Context(), ann, room)
		}
		s := collab.New(collab.Options{Store: st, Authenticate: authenticate, Extension: x, Debounce: 10 * time.Millisecond, Log: zerolog.Nop()})
		defer func() { require.NoError(t, s.Close(context.Background())) }()

		a := joinRoom(t, s, ann.ID, created.Room)
		a.eventually("the template's files came", func() bool {
			return a.doc.Texts(filesMap)["/2026/q3/main.typ"] == `#import "/template.typ": report`+"\n= New report\n"
		})
		require.Equal(t, []byte{1, 2, 3}, a.doc.Values(assetsMap)["/2026/q3/logo.png"])
		a.eventually("they are changes", func() bool {
			var c roomChanges
			return readValue(a.doc, metaChanges, &c) && len(c.Files) == 2
		})
		a.send(msgTypeStateless, varString(`{"type":"gitlab:save","message":"New report"}`))
		a.eventually("committed", func() bool { return fake.Text("main")["/2026/q3/main.typ"] != "" })
		require.Contains(t, fake.Text("main"), "/2026/_template/main.typ", "the template stays")
	})

	t.Run("the room of a folder made twice gets the files of the later one", func(t *testing.T) {
		for _, template := range []string{"", "/_templates/letter"} {
			require.Equal(t, http.StatusOK, call(x.ServeNewFolder, ann, "POST", "/", map[string]string{"ref": "main", "path": "/letters/a", "template": template}).Code)
		}
		require.Equal(t, map[string][]byte{"/letters/a/main.typ": []byte("= Letter")}, x.seeds.take("gitlab:group/report@main:/letters/a"))
		require.Nil(t, x.seeds.take("gitlab:group/report@main:/letters/a"))
	})
}

func TestSeedsForgetTheOldest(t *testing.T) {
	var s seeds
	for i := range maxSeeds + 1 {
		s.put(fmt.Sprintf("room-%d", i), map[string][]byte{"/main.typ": nil})
	}
	require.Nil(t, s.take("room-0"))
	require.NotNil(t, s.take(fmt.Sprintf("room-%d", maxSeeds)))
	require.Len(t, s.files, maxSeeds-1)
}
