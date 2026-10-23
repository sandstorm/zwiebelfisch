package fakegitlab_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"testing"
	"time"

	git "github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/config"
	"github.com/go-git/go-git/v6/plumbing"
	"github.com/go-git/go-git/v6/plumbing/client"
	"github.com/go-git/go-git/v6/plumbing/object"
	githttp "github.com/go-git/go-git/v6/plumbing/transport/http"
	"github.com/go-git/go-git/v6/storage/memory"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

// The fake as a GitLab client sees it: every request through Client (in-process, no port), REST against
// the paths and JSON of GitLab's API v4, git with go-git's client.

const project = "demo/report"

var api = fakegitlab.URL + "/api/v4/projects/" + url.PathEscape(project)

func newGitLab() *fakegitlab.GitLab {
	return fakegitlab.New(project, fakegitlab.Files{
		"/main.typ":                  []byte("#include \"chapters/introduction.typ\"\n"),
		"/chapters/introduction.typ": []byte("= Introduction <intro>\n"),
		"/assets/logo.svg":           []byte("<svg/>"),
	})
}

type answer struct {
	status int
	body   []byte
}

func (a answer) json(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	require.NoError(t, json.Unmarshal(a.body, &v), string(a.body))
	return v
}

// call GETs path below the project's API URL with token as Bearer.
func call(t *testing.T, g *fakegitlab.GitLab, token, path string) answer {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, api+path, nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := g.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return answer{res.StatusCode, b}
}

func TestAuthenticationAndProject(t *testing.T) {
	g := newGitLab()
	require.Equal(t, 401, call(t, g, "forged", "").status)
	ann := g.TokenOf("Ann")
	info := call(t, g, ann, "").json(t)
	require.Equal(t, "demo/report", info["path_with_namespace"])
	require.Equal(t, fakegitlab.URL+"/demo/report.git", info["http_url_to_repo"])

	req, _ := http.NewRequest("GET", fakegitlab.URL+"/api/v4/projects/1/repository/branches/main", nil)
	req.Header.Set("Authorization", "Bearer "+ann)
	res, err := g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 200, res.StatusCode, "the project's numeric id works as well")

	req, _ = http.NewRequest("GET", fakegitlab.URL+"/api/v4/projects/other%2Fproject", nil)
	req.Header.Set("Authorization", "Bearer "+ann)
	res, err = g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 404, res.StatusCode)

	_, err = g.Client().Get("https://gitlab.example.com/api/v4/projects/1")
	require.ErrorContains(t, err, "no such host")
}

func TestBranchesAndWhoMayPush(t *testing.T) {
	g := newGitLab()
	ann := g.TokenOf("Ann")
	main := call(t, g, ann, "/repository/branches/main").json(t)
	require.Equal(t, g.Head("main").SHA, main["commit"].(map[string]any)["id"])
	require.Equal(t, map[string]any{"protected": false, "can_push": true}, map[string]any{"protected": main["protected"], "can_push": main["can_push"]})
	require.Equal(t, 404, call(t, g, ann, "/repository/branches/fresh").status)

	g.SetAutoBranches(true)
	fresh := call(t, g, ann, "/repository/branches/"+url.PathEscape("feature/x"))
	require.Equal(t, 200, fresh.status)
	require.Equal(t, g.Head("main").SHA, fresh.json(t)["commit"].(map[string]any)["id"], "starts at main")
	require.True(t, g.HasBranch("feature/x"))

	g.Protect("main", fakegitlab.Maintainer, "Bob")
	g.SetAccess("Mai", fakegitlab.Maintainer)
	g.SetAccess("Rita", fakegitlab.Reporter)
	for name, want := range map[string]bool{"Ann": false, "Bob": true, "Mai": true, "Rita": false} {
		branch := call(t, g, g.TokenOf(name), "/repository/branches/main").json(t)
		require.Equal(t, true, branch["protected"])
		require.Equal(t, want, branch["can_push"], name)
	}
	require.Equal(t, true, call(t, g, g.TokenOf("Ann"), "/repository/branches/feature%2Fx").json(t)["can_push"])
}

// clone clones the fake's main as the token's user, in memory.
func clone(t *testing.T, g *fakegitlab.GitLab, token string) (*git.Repository, error) {
	t.Helper()
	return git.CloneContext(context.Background(), memory.NewStorage(), nil, &git.CloneOptions{
		URL: fakegitlab.URL + "/" + project + ".git", Bare: true, ClientOptions: auth(g, token),
	})
}

func auth(g *fakegitlab.GitLab, token string) []client.Option {
	return []client.Option{client.WithHTTPClient(g.Client()), client.WithHTTPAuth(&githttp.BasicAuth{Username: "oauth2", Password: token})}
}

// commit makes a commit on the clone's main that adds path, and returns it.
func commit(t *testing.T, repo *git.Repository, path string) plumbing.Hash {
	t.Helper()
	head, err := repo.Reference(plumbing.NewBranchReferenceName("main"), true)
	require.NoError(t, err)
	parent, err := repo.CommitObject(head.Hash())
	require.NoError(t, err)
	tree, err := parent.Tree()
	require.NoError(t, err)
	blob := repo.Storer.NewEncodedObject()
	blob.SetType(plumbing.BlobObject)
	w, _ := blob.Writer()
	_, _ = w.Write([]byte("new\n"))
	_ = w.Close()
	blobHash, err := repo.Storer.SetEncodedObject(blob)
	require.NoError(t, err)
	entries := append([]object.TreeEntry{{Name: path, Mode: 0o100644, Hash: blobHash}}, tree.Entries...)
	sort.Sort(object.TreeEntrySorter(entries))
	newTree := &object.Tree{Entries: entries}
	encoded := repo.Storer.NewEncodedObject()
	require.NoError(t, newTree.Encode(encoded))
	treeHash, err := repo.Storer.SetEncodedObject(encoded)
	require.NoError(t, err)
	sig := object.Signature{Name: "Ann", Email: "ann@example.com", When: time.Now()}
	c := &object.Commit{Author: sig, Committer: sig, Message: "Add " + path, TreeHash: treeHash, ParentHashes: []plumbing.Hash{head.Hash()}}
	encoded = repo.Storer.NewEncodedObject()
	require.NoError(t, c.Encode(encoded))
	h, err := repo.Storer.SetEncodedObject(encoded)
	require.NoError(t, err)
	require.NoError(t, repo.Storer.SetReference(plumbing.NewHashReference(plumbing.NewBranchReferenceName("main"), h)))
	return h
}

func push(g *fakegitlab.GitLab, repo *git.Repository, token string) error {
	return repo.PushContext(context.Background(), &git.PushOptions{
		RefSpecs: []config.RefSpec{"refs/heads/main:refs/heads/main"}, ClientOptions: auth(g, token),
	})
}

func TestGitOverHTTP(t *testing.T) {
	g := newGitLab()
	ann := g.TokenOf("Ann")
	_, err := clone(t, g, "forged")
	require.ErrorContains(t, err, "401")

	repo, err := clone(t, g, ann)
	require.NoError(t, err)
	head, err := repo.Reference(plumbing.NewBranchReferenceName("main"), true)
	require.NoError(t, err)
	require.Equal(t, g.Head("main").SHA, head.Hash().String())

	pushed := commit(t, repo, "a.typ")
	require.NoError(t, push(g, repo, ann))
	require.Equal(t, pushed.String(), g.Head("main").SHA)
	require.Equal(t, "new\n", g.Text("main")["/a.typ"])
	require.Equal(t, fakegitlab.Author{Name: "Ann", Email: "ann@example.com"}, g.Head("main").Author)
	require.Contains(t, g.Requests(), "GIT git-receive-pack")

	t.Run("refuses pushes of who may not push", func(t *testing.T) {
		g.SetAccess("Rita", fakegitlab.Reporter)
		commit(t, repo, "b.typ")
		require.ErrorContains(t, push(g, repo, g.TokenOf("Rita")), "You are not allowed to push code to this project.")
		g.Protect("main", fakegitlab.Maintainer)
		require.ErrorContains(t, push(g, repo, ann), "You are not allowed to push code to this project.")
	})

	t.Run("plays a racing colleague, a failure and an outage", func(t *testing.T) {
		g := newGitLab()
		ann := g.TokenOf("Ann")
		repo, err := clone(t, g, ann)
		require.NoError(t, err)
		commit(t, repo, "a.typ")
		g.PushBeforeNextCommit(fakegitlab.Files{"/race.typ": []byte("x")}, "racing")
		require.Error(t, push(g, repo, ann), "the ref moved after it was advertised")
		require.Equal(t, "x", g.Text("main")["/race.typ"])

		repo, err = clone(t, g, ann)
		require.NoError(t, err)
		commit(t, repo, "a.typ")
		g.FailNextCommit(http.StatusInternalServerError, "down for maintenance")
		require.ErrorContains(t, push(g, repo, ann), "down for maintenance")

		g.SetUnreachable("main", true)
		require.ErrorContains(t, push(g, repo, ann), "connection reset by peer")
		_, err = clone(t, g, ann)
		require.NoError(t, err, "fetching still works: only pushes are cut off")
		g.SetUnreachable("main", false)
		require.NoError(t, push(g, repo, ann))
	})
}
