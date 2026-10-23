package gitlab

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
)

// The history of a room's branch over HTTP (ServeHistory, ServeCompare, ServeFile with ?ref=), against
// fakeRepo; the clone's Log, Compare and File are in git_test.go.

// pushWith commits files on branch as author with message; returns the new sha.
func (r *fakeRepo) pushWith(branch string, files map[string]any, message string, author Signature) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	c := r.record(r.branches[branch], files, message, author)
	r.branches[branch] = c.sha
	return c.sha
}

// request GETs target (below /api/rooms/<room>/) as the session's user ("": signed out).
func (e *env) request(target, session string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/rooms/"+url.PathEscape(e.room.name)+"/"+target, nil)
	if session != "" {
		req.AddCookie(&http.Cookie{Name: "session", Value: session})
	}
	res := httptest.NewRecorder()
	e.routes().ServeHTTP(res, req)
	return res
}

func (e *env) history(query string) (historyPage, *httptest.ResponseRecorder) {
	res := e.request("history?"+query, "ann")
	var page historyPage
	if res.Code == http.StatusOK {
		require.NoError(e.t, json.Unmarshal(res.Body.Bytes(), &page))
	}
	return page, res
}

func shas(page historyPage) []string {
	var out []string
	for _, c := range page.Commits {
		out = append(out, c.Sha)
	}
	return out
}

func TestCoAuthors(t *testing.T) {
	t.Run("reads back the trailers withCoAuthors writes, but the author's", func(t *testing.T) {
		var e editors
		e.edited(&person{Name: "Ann", Email: "ann@example.com", User: ann.User()}, 1)
		e.edited(&person{Name: "Bob", Email: "bob@example.com", User: bob.User()}, 2)
		e.edited(&person{Name: "Cleo Example", Email: "cleo@example.com", User: cleo.User()}, 3)
		message := withCoAuthors("Edit\n\nWith a body.", e, person{Name: "Ann", User: ann.User()})
		require.Equal(t, []Signature{{"Bob", "bob@example.com"}, {"Cleo Example", "cleo@example.com"}}, parseCoAuthors(message))
	})

	t.Run("only from the last paragraph; none in a message without", func(t *testing.T) {
		require.Empty(t, parseCoAuthors("Edit"))
		require.Empty(t, parseCoAuthors("Co-authored-by: Ann <a@x>\n\nBody"))
		require.Equal(t, []Signature{{"Ann", "a@x"}}, parseCoAuthors("Edit\n\nco-authored-by: Ann <a@x>\r\n"))
	})

	t.Run("people: the author, then the co-authors, each once, never Zwiebelfisch", func(t *testing.T) {
		require.Equal(t, []string{"Ann", "Bob"}, people(CommitInfo{Author: Signature{"Ann", "a@x"}, Message: "E\n\nCo-authored-by: Bob <b@x>\nCo-authored-by: Ann <a@x>"}))
		require.Equal(t, []string{"Bob"}, people(CommitInfo{Author: Signature{nobody, "z@x"}, Message: "E\n\nCo-authored-by: Bob <b@x>"}))
	})
}

func TestHistory(t *testing.T) {
	t.Run("lists the branch's commits from the room's base, newest first, with their people", func(t *testing.T) {
		e := setup(t, setupOptions{})
		first := e.repo.head("main").sha
		e.repo.pushWith("main", map[string]any{"/ch1.typ": "= One, again\n"}, "Edits by Ann, Bob: ch1.typ\n\nCo-authored-by: Bob <bob@example.com>", Signature{"Ann", "ann@example.com"})
		page, res := e.history("")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, []string{first}, shas(page), "the room's base, not the branch's head")
		require.Equal(t, "private, no-cache", res.Header().Get("Cache-Control"))

		e.room.pullWith(t.Context(), "token")
		page, _ = e.history("")
		require.Len(t, page.Commits, 2)
		require.Equal(t, []string{"Ann", "Bob"}, page.Commits[0].People)
		require.Equal(t, []string{first}, page.Commits[0].Parents)
		require.Equal(t, []string{"Upstream"}, page.Commits[1].People)
	})

	t.Run("of a folder or a file; pages with a cursor, cached for good", func(t *testing.T) {
		e := setup(t, setupOptions{})
		e.repo.push("main", map[string]any{"/img/logo.png": []byte{1}})
		second := e.repo.push("main", map[string]any{"/ch1.typ": "= One, again\n"})
		third := e.repo.push("main", map[string]any{"/ch1.typ": "= One, third\n", "/img/logo.png": []byte{2}})
		e.room.pullWith(t.Context(), "token")

		page, _ := e.history("path=" + url.QueryEscape("/ch1.typ") + "&limit=1")
		require.Equal(t, []string{third}, shas(page))
		require.NotEmpty(t, page.Cursor)
		next, res := e.history("path=" + url.QueryEscape("/ch1.typ") + "&cursor=" + url.QueryEscape(page.Cursor))
		require.Equal(t, http.StatusOK, res.Code)
		require.Len(t, next.Commits, 2, "the second, and the first commit that made it")
		require.Equal(t, second, next.Commits[0].Sha)
		require.Empty(t, next.Cursor)
		require.Equal(t, "private, max-age=31536000, immutable", res.Header().Get("Cache-Control"))

		page, _ = e.history("path=" + url.QueryEscape("/img/"))
		require.Len(t, page.Commits, 3)

		_, res = e.history("cursor=nonsense")
		require.Equal(t, http.StatusNotFound, res.Code)
	})

	t.Run("compares a commit with its parent; serves a file at a commit, cached for good", func(t *testing.T) {
		e := setup(t, setupOptions{})
		first := e.repo.head("main").sha
		sha := e.repo.push("main", map[string]any{"/ch1.typ": "= One, again\n", "/old.typ": nil, "/new.typ": "new\n"})
		res := e.request("compare?sha="+sha, "ann")
		require.Equal(t, http.StatusOK, res.Code)
		require.JSONEq(t, `{"files":[{"path":"/ch1.typ","kind":"modified"},{"path":"/new.typ","kind":"added"},{"path":"/old.typ","kind":"deleted"}]}`, res.Body.String())
		require.Equal(t, "private, max-age=31536000, immutable", res.Header().Get("Cache-Control"))

		res = e.request("files/ch1.typ?ref="+first, "ann")
		require.Equal(t, http.StatusOK, res.Code)
		require.Equal(t, "= One\n\nText of one.\n", res.Body.String())
		require.Equal(t, "private, max-age=31536000, immutable", res.Header().Get("Cache-Control"))
		require.Equal(t, "nosniff", res.Header().Get("X-Content-Type-Options"))
		require.Equal(t, http.StatusNotFound, e.request("files/new.typ?ref="+first, "ann").Code, "not there yet")
		require.Equal(t, http.StatusNotFound, e.request("files/ch1.typ?ref=main", "ann").Code, "a sha only")
		require.Equal(t, http.StatusNotFound, e.request("compare?sha="+first[:8], "ann").Code)
	})

	t.Run("answers only whom Authenticate lets in", func(t *testing.T) {
		e := setup(t, setupOptions{})
		sha := e.repo.head("main").sha
		for _, target := range []string{"history", "compare?sha=" + sha, "files/main.typ?ref=" + sha} {
			require.Equal(t, http.StatusUnauthorized, e.request(target, "").Code, target)
		}
	})
}

func TestFolderHistory(t *testing.T) {
	t.Run("lists the folder's commits by default, and a pulled-in file's; nothing else", func(t *testing.T) {
		e := setupFolder(t)
		e.repo.push("main", map[string]any{"/reports/q2/main.typ": "= Q2, again\n"})
		inFolder := e.repo.push("main", map[string]any{q1Main: "= Q1, again\n"})
		e.room.pullWith(t.Context(), "token")

		page, res := e.history("")
		require.Equal(t, http.StatusOK, res.Code)
		require.Len(t, page.Commits, 2, "its own commit and the first, not q2's")
		require.Equal(t, inFolder, page.Commits[0].Sha)

		for _, outside := range []string{"/reports/q2/main.typ", "/reports/", "/", "/template.typ", "/../x"} {
			_, res = e.history("path=" + url.QueryEscape(outside))
			require.Equal(t, http.StatusForbidden, res.Code, outside)
		}
		require.Nil(t, e.room.pullIn("/template.typ"))
		_, res = e.history("path=" + url.QueryEscape("/template.typ"))
		require.Equal(t, http.StatusOK, res.Code, "pulled in")
	})

	t.Run("compares within the folder and the pulled-in files only; serves no other file", func(t *testing.T) {
		e := setupFolder(t)
		first := e.repo.head("main").sha
		require.Nil(t, e.room.pullIn("/template.typ"))
		sha := e.repo.push("main", map[string]any{q1Main: "= Q1, again\n", "/template.typ": "#let report(body) = body\n", "/README.md": "new"})
		res := e.request("compare?sha="+sha, "ann")
		require.JSONEq(t, `{"files":[{"path":"/reports/q1/main.typ","kind":"modified"},{"path":"/template.typ","kind":"modified"}]}`, res.Body.String())
		require.Equal(t, "private, no-cache", res.Header().Get("Cache-Control"), "what is pulled in may grow")

		require.Equal(t, http.StatusOK, e.request("files/template.typ?ref="+first, "ann").Code)
		require.Equal(t, http.StatusOK, e.request("files/reports/q1/main.typ?ref="+first, "ann").Code)
		require.Equal(t, http.StatusNotFound, e.request("files/README.md?ref="+first, "ann").Code)
		require.Equal(t, http.StatusNotFound, e.request("files/reports/q2/main.typ?ref="+first, "ann").Code)
	})
}
