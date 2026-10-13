package fakegitlab_test

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
)

// The fake as a GitLab client sees it: every request through Client (in-process, no port), against the
// paths and JSON of GitLab's API v4.

const project = "demo/report"

var api = fakegitlab.URL + "/api/v4/projects/" + url.PathEscape(project)

func newGitLab() *fakegitlab.GitLab {
	return fakegitlab.New(project, fakegitlab.Files{
		"/main.typ":                   []byte("#include \"chapters/introduction.typ\"\n"),
		"/chapters/introduction.typ":  []byte("= Introduction <intro>\n"),
		"/chapters/method.typ":        []byte("= Method\n"),
		"/assets/logo.svg":            []byte("<svg/>"),
		"/assets/diagrams/flow.svg":   []byte("<svg id=\"flow\"/>"),
		"/data/compile-times.csv":     []byte("a,b\n"),
		"/chapters/appendix/notes.md": []byte("notes"),
	})
}

type answer struct {
	status int
	header http.Header
	body   []byte
}

func (a answer) json(t *testing.T) map[string]any {
	t.Helper()
	var v map[string]any
	require.NoError(t, json.Unmarshal(a.body, &v), string(a.body))
	return v
}

func call(t *testing.T, g *fakegitlab.GitLab, method, path string, body any) answer {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		reader = strings.NewReader(string(b))
	}
	req, err := http.NewRequest(method, api+path, reader)
	require.NoError(t, err)
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := g.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	return answer{res.StatusCode, res.Header, b}
}

func commit(t *testing.T, g *fakegitlab.GitLab, body map[string]any) answer {
	t.Helper()
	return call(t, g, "POST", "/repository/commits", body)
}

func TestAuthenticationAndProject(t *testing.T) {
	g := newGitLab()
	req, _ := http.NewRequest("GET", api, nil)
	res, err := g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 401, res.StatusCode)

	req.Header.Set("Authorization", "Bearer "+fakegitlab.Token)
	res, err = g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 200, res.StatusCode)

	project := call(t, g, "GET", "", nil).json(t)
	require.Equal(t, "demo/report", project["path_with_namespace"])
	require.Equal(t, "main", project["default_branch"])

	req, _ = http.NewRequest("GET", fakegitlab.URL+"/api/v4/projects/1/repository/branches/main", nil)
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	res, err = g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 200, res.StatusCode, "the project's numeric id works as well")

	req, _ = http.NewRequest("GET", fakegitlab.URL+"/api/v4/projects/other%2Fproject", nil)
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	res, err = g.Client().Do(req)
	require.NoError(t, err)
	require.Equal(t, 404, res.StatusCode)

	_, err = g.Client().Get("https://gitlab.example.com/api/v4/projects/1")
	require.ErrorContains(t, err, "no such host")
}

func TestBranches(t *testing.T) {
	g := newGitLab()
	main := call(t, g, "GET", "/repository/branches/main", nil).json(t)
	require.Equal(t, g.Head("main").SHA, main["commit"].(map[string]any)["id"])
	require.Equal(t, 404, call(t, g, "GET", "/repository/branches/fresh", nil).status)

	g.SetAutoBranches(true)
	fresh := call(t, g, "GET", "/repository/branches/"+url.PathEscape("feature/x"), nil)
	require.Equal(t, 200, fresh.status)
	require.Equal(t, g.Head("main").SHA, fresh.json(t)["commit"].(map[string]any)["id"], "starts at main")
	require.True(t, g.HasBranch("feature/x"))
}

func TestTreePagesAndFolders(t *testing.T) {
	g := newGitLab()
	var blobs []string
	var trees []string
	for page := "1"; page != ""; {
		a := call(t, g, "GET", "/repository/tree?ref=main&recursive=true&per_page=3&page="+page, nil)
		require.Equal(t, 200, a.status)
		var items []struct{ ID, Name, Type, Path string }
		require.NoError(t, json.Unmarshal(a.body, &items))
		require.LessOrEqual(t, len(items), 3)
		for _, item := range items {
			if item.Type == "blob" {
				blobs = append(blobs, item.Path)
				if item.Path == "assets/logo.svg" {
					require.Equal(t, fakegitlab.BlobSHA([]byte("<svg/>")), item.ID)
					require.Equal(t, "logo.svg", item.Name)
				}
			} else {
				trees = append(trees, item.Path)
			}
		}
		page = a.header.Get("X-Next-Page")
	}
	require.Equal(t, []string{"assets/diagrams/flow.svg", "assets/logo.svg", "chapters/appendix/notes.md",
		"chapters/introduction.typ", "chapters/method.typ", "data/compile-times.csv", "main.typ"}, blobs)
	require.Equal(t, []string{"assets", "assets/diagrams", "chapters", "chapters/appendix", "data"}, trees)

	var top []struct{ Type, Path string }
	require.NoError(t, json.Unmarshal(call(t, g, "GET", "/repository/tree?ref=main&per_page=100", nil).body, &top))
	require.Equal(t, []struct{ Type, Path string }{{"tree", "assets"}, {"tree", "chapters"}, {"tree", "data"}, {"blob", "main.typ"}}, top,
		"without recursive: the top level only")

	var chapters []struct{ Type, Path string }
	require.NoError(t, json.Unmarshal(call(t, g, "GET", "/repository/tree?ref=main&path=chapters&per_page=100", nil).body, &chapters))
	require.Equal(t, []struct{ Type, Path string }{{"tree", "chapters/appendix"}, {"blob", "chapters/introduction.typ"}, {"blob", "chapters/method.typ"}}, chapters)

	require.Equal(t, 404, call(t, g, "GET", "/repository/tree?ref=nope", nil).status)
}

func TestFilesAndBlobs(t *testing.T) {
	g := newGitLab()
	first := g.Head("main").SHA
	g.Push("main", fakegitlab.Files{"/chapters/method.typ": []byte("= Method, revised\n")}, "Revise the method")

	file := call(t, g, "GET", "/repository/files/"+url.PathEscape("chapters/introduction.typ")+"?ref=main", nil).json(t)
	content, err := base64.StdEncoding.DecodeString(file["content"].(string))
	require.NoError(t, err)
	require.Equal(t, "= Introduction <intro>\n", string(content))
	require.Equal(t, first, file["last_commit_id"], "the file did not change since the first commit")
	require.Equal(t, fakegitlab.BlobSHA(content), file["blob_id"])

	method := call(t, g, "GET", "/repository/files/"+url.PathEscape("chapters/method.typ")+"?ref=main", nil).json(t)
	require.Equal(t, g.Head("main").SHA, method["last_commit_id"])
	old := call(t, g, "GET", "/repository/files/"+url.PathEscape("chapters/method.typ")+"?ref="+first, nil).json(t)
	require.Equal(t, first, old["last_commit_id"], "a sha works as ref")

	require.Equal(t, 404, call(t, g, "GET", "/repository/files/missing.typ?ref=main", nil).status)

	raw := call(t, g, "GET", "/repository/blobs/"+fakegitlab.BlobSHA([]byte("= Method\n"))+"/raw", nil)
	require.Equal(t, 200, raw.status)
	require.Equal(t, "= Method\n", string(raw.body), "blobs of earlier commits stay readable")
	require.Equal(t, 404, call(t, g, "GET", "/repository/blobs/0000/raw", nil).status)
}

func TestCommitWithActions(t *testing.T) {
	g := newGitLab()
	parent := g.Head("main")
	png := []byte{0x89, 'P', 'N', 'G'}
	message := "Edit the report\n\nCo-authored-by: Ann <ann@example.com>\nCo-authored-by: Bob <bob@example.com>"
	a := commit(t, g, map[string]any{
		"branch": "main", "commit_message": message,
		"actions": []map[string]any{
			{"action": "create", "file_path": "chapters/results.typ", "content": "= Results\n"},
			{"action": "update", "file_path": "chapters/introduction.typ", "content": "= Intro\n", "last_commit_id": parent.SHA},
			{"action": "create", "file_path": "assets/plot.png", "content": base64.StdEncoding.EncodeToString(png), "encoding": "base64"},
			{"action": "delete", "file_path": "data/compile-times.csv"},
			{"action": "move", "file_path": "chapters/methods.typ", "previous_path": "chapters/method.typ"},
		},
	})
	require.Equal(t, 201, a.status, string(a.body))
	body := a.json(t)
	head := g.Head("main")
	require.Equal(t, head.SHA, body["id"])
	require.Equal(t, []any{parent.SHA}, body["parent_ids"])
	require.Equal(t, "Edit the report", body["title"])
	require.Equal(t, message, head.Message, "trailers are kept as sent")
	require.Equal(t, fakegitlab.Author{Name: fakegitlab.BotName, Email: fakegitlab.BotEmail}, head.Author,
		"without author_name the token's user (the bot) is the author")
	require.Equal(t, parent.SHA, head.Parent)

	texts := g.Text("main")
	require.Equal(t, "= Results\n", texts["/chapters/results.typ"])
	require.Equal(t, "= Intro\n", texts["/chapters/introduction.typ"])
	require.Equal(t, "= Method\n", texts["/chapters/methods.typ"], "a move without content keeps it")
	require.NotContains(t, texts, "/chapters/method.typ")
	require.NotContains(t, texts, "/data/compile-times.csv")
	require.Equal(t, png, head.Files["/assets/plot.png"])

	info := call(t, g, "GET", "/repository/commits/"+head.SHA, nil).json(t)
	require.Equal(t, message, info["message"])
	require.Equal(t, fakegitlab.BotName, info["author_name"])
}

func TestCommitRefusals(t *testing.T) {
	g := newGitLab()
	head := g.Head("main").SHA
	g.Push("main", fakegitlab.Files{"/chapters/introduction.typ": []byte("= Changed upstream\n")}, "Upstream")
	for name, tc := range map[string]struct {
		body    map[string]any
		message string
	}{
		"create over a file": {map[string]any{"branch": "main", "commit_message": "m",
			"actions": []map[string]any{{"action": "create", "file_path": "main.typ", "content": "x"}}}, "A file with this name already exists"},
		"update a missing file": {map[string]any{"branch": "main", "commit_message": "m",
			"actions": []map[string]any{{"action": "update", "file_path": "nope.typ", "content": "x"}}}, "A file with this name doesn't exist"},
		"stale last_commit_id": {map[string]any{"branch": "main", "commit_message": "m",
			"actions": []map[string]any{{"action": "update", "file_path": "chapters/introduction.typ", "content": "x", "last_commit_id": head}}},
			"You are attempting to update a file that has changed since you started editing it."},
		"no such branch": {map[string]any{"branch": "nope", "commit_message": "m",
			"actions": []map[string]any{{"action": "create", "file_path": "x.typ", "content": "x"}}}, "You can only create or edit files when you are on a branch"},
		"start_sha onto an existing branch": {map[string]any{"branch": "main", "start_sha": head, "commit_message": "m",
			"actions": []map[string]any{{"action": "create", "file_path": "x.typ", "content": "x"}}},
			"A branch called 'main' already exists. Switch to that branch in order to make changes"},
		"an unknown start_sha": {map[string]any{"branch": "side", "start_sha": "0000", "commit_message": "m",
			"actions": []map[string]any{{"action": "create", "file_path": "x.typ", "content": "x"}}}, "Invalid start_sha 0000"},
	} {
		t.Run(name, func(t *testing.T) {
			before := g.Head("main").SHA
			a := commit(t, g, tc.body)
			require.Equal(t, 400, a.status)
			require.Equal(t, tc.message, a.json(t)["message"])
			require.Equal(t, before, g.Head("main").SHA, "nothing committed")
		})
	}
}

// The branch-level conflict check of GitLab rooms: commit from the base the room has (start_sha) to a
// side branch, or compare the branch's head with it right before committing.
func TestStartSHAAndForce(t *testing.T) {
	g := newGitLab()
	base := g.Head("main").SHA
	upstream := g.Push("main", fakegitlab.Files{"/main.typ": []byte("upstream\n")}, "Upstream")

	room := func(force bool) answer {
		return commit(t, g, map[string]any{
			"branch": "room/side", "start_sha": base, "force": force, "commit_message": "Room",
			"author_name": "Ann", "author_email": "ann@example.com",
			"actions": []map[string]any{{"action": "update", "file_path": "chapters/method.typ", "content": "room\n"}},
		})
	}
	require.Equal(t, 201, room(false).status, "a new branch starts at start_sha")
	side := g.Head("room/side")
	require.Equal(t, base, side.Parent)
	require.Equal(t, fakegitlab.Author{Name: "Ann", Email: "ann@example.com"}, side.Author)
	require.Equal(t, "#include \"chapters/introduction.typ\"\n", g.Text("room/side")["/main.typ"], "not upstream's")
	require.Equal(t, upstream, g.Head("main").SHA, "main untouched")

	require.Equal(t, 400, room(false).status, "the side branch exists now")
	require.Equal(t, 201, room(true).status, "force overwrites it: again base + the room")
	require.Equal(t, base, g.Head("room/side").Parent)

	a := commit(t, g, map[string]any{"branch": "copy", "start_branch": "main", "commit_message": "m",
		"actions": []map[string]any{{"action": "create", "file_path": "x.typ", "content": "x"}}})
	require.Equal(t, 201, a.status)
	require.Equal(t, upstream, g.Head("copy").Parent, "start_branch: from its head")
}

func TestPushBeforeNextCommitRacesIt(t *testing.T) {
	g := newGitLab()
	base := g.Head("main").SHA
	g.PushBeforeNextCommit(fakegitlab.Files{"/main.typ": []byte("colleague\n")}, "Colleague")

	head := call(t, g, "GET", "/repository/branches/main", nil).json(t)["commit"].(map[string]any)["id"]
	require.Equal(t, base, head, "the head check before committing still sees the base")
	a := commit(t, g, map[string]any{"branch": "main", "commit_message": "Room",
		"actions": []map[string]any{{"action": "update", "file_path": "chapters/method.typ", "content": "room\n"}}})
	require.Equal(t, 201, a.status, "GitLab commits on top of the colleague's push: no compare-and-swap")
	racer := g.Head("main").Parent
	require.NotEqual(t, base, racer)
	require.Equal(t, "colleague\n", g.Text("main")["/main.typ"])

	g.PushBeforeNextCommit(fakegitlab.Files{"/chapters/method.typ": []byte("colleague\n")}, "Colleague")
	a = commit(t, g, map[string]any{"branch": "main", "commit_message": "Room",
		"actions": []map[string]any{{"action": "update", "file_path": "chapters/method.typ", "content": "room 2\n", "last_commit_id": g.Head("main").SHA}}})
	require.Equal(t, 400, a.status, "last_commit_id still catches a race on the same file")
}

func TestFailNextCommit(t *testing.T) {
	g := newGitLab()
	g.FailNextCommit(500, "500 Internal Server Error")
	body := map[string]any{"branch": "main", "commit_message": "m",
		"actions": []map[string]any{{"action": "create", "file_path": "x.typ", "content": "x"}}}
	a := commit(t, g, body)
	require.Equal(t, 500, a.status)
	require.Equal(t, "500 Internal Server Error", a.json(t)["message"])
	require.Equal(t, 201, commit(t, g, body).status, "only the next one")
}

func TestUnreachableBranch(t *testing.T) {
	g := newGitLab()
	g.SetAutoBranches(true)
	g.SetUnreachable("main", true)
	req, _ := http.NewRequest("GET", api+"/repository/branches/main", nil)
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	_, err := g.Client().Do(req)
	require.ErrorContains(t, err, "connection reset")
	req, _ = http.NewRequest("POST", api+"/repository/commits", strings.NewReader(`{"branch":"main"}`))
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	_, err = g.Client().Do(req)
	require.Error(t, err)

	require.Equal(t, 200, call(t, g, "GET", "/repository/branches/other", nil).status, "other branches are reachable")
	require.Equal(t, 200, call(t, g, "GET", "/repository/tree?ref=main", nil).status, "reads by ref are not about the branch")
	g.SetUnreachable("main", false)
	require.Equal(t, 200, call(t, g, "GET", "/repository/branches/main", nil).status)

	require.Equal(t, []string{
		"GET /repository/branches/main", "POST /repository/commits", "GET /repository/branches/other",
		"GET /repository/tree?ref=main", "GET /repository/branches/main",
	}, g.Requests())
}

// Over a real connection an outage drops it without an answer. Needs a port: skips in the agent sandbox.
func TestUnreachableOverHTTP(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("cannot bind a port here: %v", err)
	}
	probe.Close()
	g := newGitLab()
	server := httptest.NewServer(g)
	defer server.Close()
	g.SetUnreachable("main", true)
	req, _ := http.NewRequest("GET", server.URL+"/api/v4/projects/demo%2Freport/repository/branches/main", nil)
	req.Header.Set("PRIVATE-TOKEN", fakegitlab.Token)
	_, err = server.Client().Do(req)
	require.Error(t, err)
	g.SetUnreachable("main", false)
	res, err := server.Client().Do(req)
	require.NoError(t, err)
	res.Body.Close()
	require.Equal(t, 200, res.StatusCode)
}
