package gitlab

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// GitLab's REST API (api.go) against a handler that answers as GitLab does, in-process (no port).

type handlerTransport struct{ h http.Handler }

func (t handlerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	res := httptest.NewRecorder()
	t.h.ServeHTTP(res, req)
	return res.Result(), nil
}

// gitlabAPI is the part of GitLab's API a project uses, with a head the test sets and the commits it got.
type gitlabAPI struct {
	head        string
	headAfter   string // the head once a commit was requested (a push in between)
	commitError int    // answer commits with this status
	commits     []map[string]any
	posted      bool
	tree        int // files in the tree
}

func (g *gitlabAPI) handler(t *testing.T) http.Handler {
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("PRIVATE-TOKEN") != "bot-token" {
				http.Error(w, `{"message":"401 Unauthorized"}`, http.StatusUnauthorized)
				return
			}
			require.Equal(t, "/api/v4/projects/group%2Freport/", r.URL.EscapedPath()[:len("/api/v4/projects/group%2Freport/")])
			h(w, r)
		}
	}
	mux.HandleFunc("GET /api/v4/projects/{project}/repository/branches/{branch}", auth(func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("branch") != "feature/x" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"404 Branch Not Found"}`))
			return
		}
		head := g.head
		if g.posted && g.headAfter != "" {
			head = g.headAfter
		}
		_, _ = fmt.Fprintf(w, `{"name":"feature/x","commit":{"id":%q}}`, head)
	}))
	mux.HandleFunc("GET /api/v4/projects/{project}/repository/tree", auth(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		require.Equal(t, "c1", q.Get("ref"))
		require.Equal(t, "true", q.Get("recursive"))
		perPage, _ := strconv.Atoi(q.Get("per_page"))
		page, _ := strconv.Atoi(q.Get("page"))
		var items []map[string]string
		for i := (page - 1) * perPage; i < min(page*perPage, g.tree); i++ {
			items = append(items, map[string]string{"id": fmt.Sprintf("sha%d", i), "type": "blob", "path": fmt.Sprintf("data/%03d.csv", i)})
		}
		if page == 1 {
			items = append(items, map[string]string{"id": "t", "type": "tree", "path": "data"})
		}
		if page*perPage < g.tree {
			w.Header().Set("X-Next-Page", strconv.Itoa(page+1))
		} else {
			w.Header().Set("X-Next-Page", "")
		}
		_ = json.NewEncoder(w).Encode(items)
	}))
	mux.HandleFunc("GET /api/v4/projects/{project}/repository/blobs/{sha}/raw", auth(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("bytes of " + r.PathValue("sha")))
	}))
	mux.HandleFunc("POST /api/v4/projects/{project}/repository/commits", auth(func(w http.ResponseWriter, r *http.Request) {
		g.posted = true
		if g.commitError != 0 {
			w.WriteHeader(g.commitError)
			_, _ = w.Write([]byte(`{"message":"A file with this name already exists"}`))
			return
		}
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		g.commits = append(g.commits, body)
		_, _ = fmt.Fprintf(w, `{"id":"c2","parent_ids":[%q]}`, g.head)
	}))
	return mux
}

func newTestProject(t *testing.T, g *gitlabAPI) *project {
	return newProject("https://gitlab.test/", "bot-token", "group/report", &http.Client{Transport: handlerTransport{g.handler(t)}})
}

func TestProjectReadsHeadTreeAndBlobs(t *testing.T) {
	g := &gitlabAPI{head: "c1", tree: 150}
	p := newTestProject(t, g)
	ctx := context.Background()
	head, err := p.Head(ctx, "feature/x")
	require.NoError(t, err)
	require.Equal(t, "c1", head)

	entries, err := p.Tree(ctx, "c1")
	require.NoError(t, err)
	require.Len(t, entries, 150, "every page, files only")
	require.Equal(t, TreeEntry{Path: "/data/149.csv", Sha: "sha149"}, entries[149])

	blob, err := p.Blob(ctx, "sha7")
	require.NoError(t, err)
	require.Equal(t, "bytes of sha7", string(blob))

	_, err = p.Head(ctx, "gone")
	var refused *APIError
	require.ErrorAs(t, err, &refused)
	require.Equal(t, &APIError{Status: 404, Message: "404 Branch Not Found"}, refused)

	wrong := newProject("https://gitlab.test", "other", "group/report", &http.Client{Transport: handlerTransport{g.handler(t)}})
	_, err = wrong.Head(ctx, "feature/x")
	require.ErrorAs(t, err, &refused)
	require.Equal(t, 401, refused.Status)
}

func TestProjectCommitsAsTheBot(t *testing.T) {
	g := &gitlabAPI{head: "c1", headAfter: "c2"}
	p := newTestProject(t, g)
	c, err := p.Commit(context.Background(), CommitRequest{
		Branch: "feature/x", ExpectedHead: "c1", Message: "Edits\n\nCo-authored-by: Ann <ann@example.com>",
		Actions: []Action{
			{Kind: ActionUpdate, Path: "/main.typ", Content: []byte("text"), Text: true},
			{Kind: ActionCreate, Path: "/img/a.png", Content: []byte{1, 2}},
			{Kind: ActionMove, Path: "/b.png", PreviousPath: "/a.png"},
			{Kind: ActionDelete, Path: "/old.typ"},
		},
	})
	require.NoError(t, err)
	require.Equal(t, Commit{Sha: "c2", Parent: "c1"}, c)
	require.Equal(t, []map[string]any{{
		"branch": "feature/x", "commit_message": "Edits\n\nCo-authored-by: Ann <ann@example.com>",
		"actions": []any{
			map[string]any{"action": "update", "file_path": "main.typ", "content": "text", "encoding": "text"},
			map[string]any{"action": "create", "file_path": "img/a.png", "content": "AQI=", "encoding": "base64"},
			map[string]any{"action": "move", "file_path": "b.png", "previous_path": "a.png"},
			map[string]any{"action": "delete", "file_path": "old.typ"},
		},
	}}, g.commits, "no author_name: the bot is the author")
}

func TestProjectCommitChecksTheBranch(t *testing.T) {
	ctx := context.Background()
	request := CommitRequest{Branch: "feature/x", ExpectedHead: "c0", Message: "m", Actions: []Action{{Kind: ActionDelete, Path: "/a"}}}

	g := &gitlabAPI{head: "c1"}
	_, err := newTestProject(t, g).Commit(ctx, request)
	require.ErrorIs(t, err, ErrConflict, "moved before the commit")
	require.Empty(t, g.commits)

	request.ExpectedHead = "c1"
	g = &gitlabAPI{head: "c1", headAfter: "c9", commitError: 400}
	_, err = newTestProject(t, g).Commit(ctx, request)
	require.ErrorIs(t, err, ErrConflict, "refused because of a push in between")
	require.True(t, g.posted)

	g = &gitlabAPI{head: "c1", commitError: 400}
	_, err = newTestProject(t, g).Commit(ctx, request)
	var refused *APIError
	require.ErrorAs(t, err, &refused, "refused for another reason")
	require.Equal(t, "A file with this name already exists", refused.Message)
	require.Equal(t, "A file with this name already exists", failureMessage(err))
}

func TestProjectUnreachable(t *testing.T) {
	down := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("connection refused") })}
	_, err := newProject("https://gitlab.test", "t", "1", down).Head(context.Background(), "main")
	require.Error(t, err)
	var refused *APIError
	require.False(t, errors.As(err, &refused))
	require.Contains(t, failureMessage(err), "GitLab could not be reached (")
}

func TestErrorMessages(t *testing.T) {
	for body, want := range map[string]string{
		`{"message":"m"}`:                     "m",
		`{"error":"e"}`:                       "e",
		`{"message":{"base":["is invalid"]}}`: `{"base":["is invalid"]}`,
		`plain`:                               "plain",
		``:                                    "502 Bad Gateway",
	} {
		res := &http.Response{Status: "502 Bad Gateway", Body: io.NopCloser(strings.NewReader(body))}
		require.Equal(t, want, errorMessage(res), body)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
