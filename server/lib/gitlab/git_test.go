package gitlab

import (
	"bytes"
	"context"
	"crypto/rand"
	"io/fs"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	git "github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/config"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// The git clone (git.go) against go-git's server in the fake GitLab, and against `git http-backend` (as
// GitLab serves git) where a git binary is installed.

func newFake() *fakegitlab.GitLab {
	return fakegitlab.New("group/report", fakegitlab.Files{
		"/main.typ": []byte(mainText), "/chapters/one.typ": []byte("= One\n"), "/img/logo.png": logo,
	})
}

func fakeRepoOf(fake *fakegitlab.GitLab, project, dir string) *gitRepo {
	return newGitRepo(project, dir, api{instance: fakegitlab.URL, client: fake.Client()}, Signature{"Zwiebelfisch", "zwiebelfisch@localhost"})
}

func TestGitRepository(t *testing.T) {
	ctx := context.Background()
	for _, where := range []string{"memory", "disk"} {
		t.Run(where, func(t *testing.T) {
			fake := newFake()
			dir := ""
			if where == "disk" {
				dir = filepath.Join(t.TempDir(), "clone")
			}
			g := fakeRepoOf(fake, "group/report", dir)
			ann := fake.TokenOf("Ann")

			head, err := g.Head(ctx, ann, "main")
			require.NoError(t, err)
			require.Equal(t, fake.Head("main").SHA, head)
			tree, err := g.Tree(head)
			require.NoError(t, err)
			require.Equal(t, []TreeEntry{{"/chapters/one.typ", blobSha([]byte("= One\n"))}, {"/img/logo.png", blobSha(logo)}, {"/main.typ", blobSha([]byte(mainText))}}, tree)
			blobs, err := g.Blobs([]string{blobSha(logo), blobSha([]byte(mainText))})
			require.NoError(t, err)
			require.Equal(t, [][]byte{logo, []byte(mainText)}, blobs)

			sha, err := g.Commit(ctx, ann, CommitRequest{
				Branch: "main", ExpectedHead: head, Message: "Edit\n\nCo-authored-by: Bob <bob@example.com>",
				Author: Signature{"Ann", "ann@example.com"},
				Actions: []Action{
					{Kind: ActionUpdate, Path: "/main.typ", Content: []byte("= Report v2\n")},
					{Kind: ActionCreate, Path: "/deep/er/new.typ", Content: []byte("new\n")},
					{Kind: ActionMove, Path: "/one.typ", PreviousPath: "/chapters/one.typ"},
					{Kind: ActionMove, Path: "/logo.png", PreviousPath: "/img/logo.png", Content: []byte{1}},
				},
			})
			require.NoError(t, err)
			pushed := fake.Head("main")
			require.Equal(t, sha, pushed.SHA)
			require.Equal(t, head, pushed.Parent)
			require.Equal(t, fakegitlab.Author{Name: "Ann", Email: "ann@example.com"}, pushed.Author, "who pushes")
			require.Equal(t, fakegitlab.Author{Name: "Zwiebelfisch", Email: "zwiebelfisch@localhost"}, pushed.Committer)
			require.Equal(t, "Edit\n\nCo-authored-by: Bob <bob@example.com>", pushed.Message)
			require.Equal(t, fakegitlab.Files{"/main.typ": []byte("= Report v2\n"), "/deep/er/new.typ": []byte("new\n"), "/one.typ": []byte("= One\n"), "/logo.png": {1}}, pushed.Files)

			t.Run("a commit on a head that moved is a conflict, and so is a push that races it", func(t *testing.T) {
				fake.Push("main", fakegitlab.Files{"/other.typ": []byte("x")}, "a colleague")
				_, err := g.Commit(ctx, ann, CommitRequest{Branch: "main", ExpectedHead: sha, Message: "stale", Author: Signature{"Ann", "a@x"},
					Actions: []Action{{Kind: ActionDelete, Path: "/one.typ"}}})
				require.ErrorIs(t, err, ErrConflict)

				head, err := g.Head(ctx, ann, "main")
				require.NoError(t, err)
				fake.PushBeforeNextCommit(fakegitlab.Files{"/race.typ": []byte("raced in")}, "racing")
				_, err = g.Commit(ctx, ann, CommitRequest{Branch: "main", ExpectedHead: head, Message: "mine", Author: Signature{"Ann", "a@x"},
					Actions: []Action{{Kind: ActionDelete, Path: "/one.typ"}}})
				require.ErrorIs(t, err, ErrConflict)
				require.Equal(t, "raced in", fake.Text("main")["/race.typ"], "the other push survives")
			})

			t.Run("GitLab's refusals in its words", func(t *testing.T) {
				_, err := g.Head(ctx, "forged", "main")
				var refused *APIError
				require.ErrorAs(t, err, &refused)
				require.Equal(t, http.StatusUnauthorized, refused.Status)
				require.Equal(t, "HTTP Basic: Access denied", refused.Message)

				_, err = g.Head(ctx, ann, "nowhere")
				require.EqualError(t, err, "GitLab has no branch nowhere in group/report")

				head, _ := g.Head(ctx, ann, "main")
				fake.SetAccess("Rita", fakegitlab.Reporter)
				_, err = g.Commit(ctx, fake.TokenOf("Rita"), CommitRequest{Branch: "main", ExpectedHead: head, Message: "x", Author: Signature{"Rita", "r@x"},
					Actions: []Action{{Kind: ActionDelete, Path: "/one.typ"}}})
				require.EqualError(t, err, "You are not allowed to push code to this project.")

				fake.SetUnreachable("main", true)
				_, err = g.Commit(ctx, ann, CommitRequest{Branch: "main", ExpectedHead: head, Message: "x", Author: Signature{"Ann", "a@x"},
					Actions: []Action{{Kind: ActionDelete, Path: "/one.typ"}}})
				require.ErrorContains(t, err, "connection reset by peer")
				require.Equal(t, "GitLab could not be reached", failureMessage(err)[:len("GitLab could not be reached")])
				fake.SetUnreachable("main", false)
			})
		})
	}

	t.Run("a project named by its id is cloned by its path", func(t *testing.T) {
		fake := newFake()
		g := fakeRepoOf(fake, "1", "")
		head, err := g.Head(ctx, fake.TokenOf("Ann"), "main")
		require.NoError(t, err)
		require.Equal(t, fake.Head("main").SHA, head)
		remote, err := g.repo.Remote(remoteName)
		require.NoError(t, err)
		require.Equal(t, []string{fakegitlab.URL + "/group/report.git"}, remote.Config().URLs)
	})

	t.Run("a clone on disk follows the project's path as GitLab names it now", func(t *testing.T) {
		fake := newFake()
		dir := filepath.Join(t.TempDir(), "clone")
		repo, err := git.PlainInit(dir, true)
		require.NoError(t, err)
		_, err = repo.CreateRemote(&config.RemoteConfig{Name: remoteName, URLs: []string{fakegitlab.URL + "/old/path.git"}})
		require.NoError(t, err)
		g := fakeRepoOf(fake, "1", dir)
		head, err := g.Head(ctx, fake.TokenOf("Ann"), "main")
		require.NoError(t, err)
		require.Equal(t, fake.Head("main").SHA, head)
		repo, err = git.PlainOpen(dir)
		require.NoError(t, err)
		remote, err := repo.Remote(remoteName)
		require.NoError(t, err)
		require.Equal(t, []string{fakegitlab.URL + "/group/report.git"}, remote.Config().URLs)
	})

	t.Run("commits no path git would refuse, and nothing of such a commit", func(t *testing.T) {
		fake := newFake()
		g := fakeRepoOf(fake, "group/report", "")
		ann := fake.TokenOf("Ann")
		head, err := g.Head(ctx, ann, "main")
		require.NoError(t, err)
		for _, p := range []string{"/a//b.typ", "/../b.typ", "/a/./b.typ", "/.git/config", "/x/.GIT/y", "/", "/main.typ/inside.typ"} {
			_, err := g.Commit(ctx, ann, CommitRequest{Branch: "main", ExpectedHead: head, Message: "x", Author: Signature{"Ann", "a@x"},
				Actions: []Action{{Kind: ActionCreate, Path: p, Content: []byte("x")}}})
			require.ErrorIs(t, err, errBadPath, p)
			require.Regexp(t, `^/\S* is not a file name git takes$`, failureMessage(err))
		}
		require.Equal(t, head, fake.Head("main").SHA)
	})

	t.Run("does not read a file larger than the limit", func(t *testing.T) {
		big := make([]byte, maxBlobSize+1)
		fake := fakegitlab.New("group/report", fakegitlab.Files{"/big.bin": big})
		g := fakeRepoOf(fake, "group/report", "")
		ann := fake.TokenOf("Ann")
		_, err := g.Head(ctx, ann, "main")
		require.NoError(t, err)
		_, err = g.Blobs([]string{blobSha(big)})
		require.ErrorIs(t, err, errTooLarge)
		require.Equal(t, "a file is larger than 32 MiB, more than Zwiebelfisch reads", failureMessage(err))
	})
}

// No token is ever written: not into the clone (its config, its remote, its objects), the room, the log,
// also when GitLab refuses or cannot be reached.
func TestTokensStayInMemory(t *testing.T) {
	fake := newFake()
	dir := t.TempDir()
	var log bytes.Buffer
	ann, bob := fake.TokenOf("Ann"), fake.TokenOf("Bob")
	users := map[string]string{"2": ann, "3": bob} // the fake's ids of Ann and Bob
	x := New(Options{
		URL: fakegitlab.URL, Client: fake.Client(), Dir: dir, AutoCommit: 0,
		Log:   zerolog.New(&log).Level(zerolog.DebugLevel),
		Token: func(_ context.Context, user string) (string, error) { return users[user], nil },
	})
	defer x.Close()
	annUser := collab.User{Provider: DefaultID, ID: "2", Name: "Ann", Email: "ann@example.com"}
	require.NoError(t, x.Authorize(context.Background(), annUser, roomName))
	host := &fakeHost{doc: ydoc.New(), users: []collab.User{annUser}}
	var r *room
	var err error
	host.Do(func(doc *ydoc.Doc) { r, err = x.openRoom(roomName, host, doc, annUser) })
	require.NoError(t, err)
	defer host.Do(func(*ydoc.Doc) { r.Close() })
	host.Do(func(doc *ydoc.Doc) {
		require.NoError(t, doc.Write(&testClient{"Ann", "ann@example.com", "2"}, func(w *ydoc.Writer) { w.Edit(filesMap, mainTyp, 0, 0, "Hello. ") }))
	})
	require.Equal(t, msgSaved, r.save(context.Background(), person{User: annUser, Name: "Ann", Email: "ann@example.com"}, "Edit").Type)
	fake.Push("main", fakegitlab.Files{"/chapters/one.typ": []byte("pushed")}, "a colleague")
	x.pushed(context.Background(), []string{"group/report"}, "main")
	_, _, err = r.asset("/img/logo.png")
	require.NoError(t, err)
	// failures, whose errors are logged
	users["2"] = "forged-" + ann
	_, err = r.repo.Head(context.Background(), users["2"], "main")
	require.Error(t, err)
	x.pushed(context.Background(), []string{"group/report"}, "main")
	users["2"] = ann
	fake.SetUnreachable("main", true)
	host.Do(func(doc *ydoc.Doc) {
		require.NoError(t, doc.Write(nil, func(w *ydoc.Writer) { w.Edit(filesMap, mainTyp, 0, 0, "Again. ") }))
	})
	require.Equal(t, msgError, r.save(context.Background(), person{User: annUser, Name: "Ann", Email: "ann@example.com"}, "Edit").Type)

	files := 0
	require.NoError(t, filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		content, err := os.ReadFile(p)
		require.NoError(t, err)
		files++
		for _, token := range []string{ann, bob} {
			require.False(t, bytes.Contains(content, []byte(token)), "a token in %s", p)
		}
		return nil
	}))
	require.Greater(t, files, 5, "the clone is on disk")
	host.Do(func(doc *ydoc.Doc) {
		require.False(t, bytes.Contains(doc.State(), []byte(ann)), "a token in the room (stored as it is)")
	})
	require.NotEmpty(t, log.String())
	require.NotContains(t, log.String(), ann)
}

// A clone against `git http-backend`, as GitLab serves git: every file read locally, pushed commits and an
// upkeep that git itself accepts, GitLab's refusal of a push in its words.
func TestCloneAgainstGit(t *testing.T) {
	gitPath, err := exec.LookPath("git")
	if err != nil {
		t.Skip("no git binary")
	}
	ctx := context.Background()
	root := t.TempDir()
	bare := filepath.Join(root, "group", "report.git")
	run := func(dir string, args ...string) string {
		t.Helper()
		cmd := exec.Command(gitPath, args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Seed", "GIT_AUTHOR_EMAIL=seed@x", "GIT_COMMITTER_NAME=Seed",
			"GIT_COMMITTER_EMAIL=seed@x", "GIT_CONFIG_NOSYSTEM=1", "HOME="+root)
		out, err := cmd.CombinedOutput()
		require.NoError(t, err, "git %v: %s", args, out)
		return strings.TrimSpace(string(out))
	}
	require.NoError(t, os.MkdirAll(bare, 0o755))
	run(bare, "init", "-q", "--bare", "-b", "main")
	run(bare, "config", "http.receivepack", "true")
	work := filepath.Join(root, "work")
	run(root, "init", "-q", "-b", "main", work)
	big := make([]byte, 1<<20)
	_, _ = rand.Read(big)
	for p, content := range map[string][]byte{"main.typ": []byte(mainText), "chapters/one.typ": []byte("= One\n"), "media/video.bin": big} {
		require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(work, p)), 0o755))
		require.NoError(t, os.WriteFile(filepath.Join(work, p), content, 0o644))
	}
	run(work, "add", "-A")
	run(work, "commit", "-q", "-m", "seed")
	run(work, "push", "-q", bare, "main")

	const token = "user-token-0123456789"
	backend := &cgi.Handler{Path: gitPath, Args: []string{"http-backend"}, Root: "/",
		Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=oauth2", "GIT_CONFIG_NOSYSTEM=1", "HOME=" + root}}
	server := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, pass, ok := r.BasicAuth(); !ok || user != "oauth2" || pass != token {
			w.Header().Set("WWW-Authenticate", `Basic realm="GitLab"`)
			http.Error(w, "HTTP Basic: Access denied", http.StatusUnauthorized)
			return
		}
		backend.ServeHTTP(w, r)
	})
	dir := filepath.Join(t.TempDir(), "clone")
	g := newGitRepo("group/report", dir, api{instance: "http://git.test", client: &http.Client{Transport: handlerTransport{server}}}, Signature{"Zwiebelfisch", "z@x"})

	head, err := g.Head(ctx, token, "main")
	require.NoError(t, err)
	require.Equal(t, run(bare, "rev-parse", "main"), head)
	tree, err := g.Tree(head)
	require.NoError(t, err)
	shas := []string{}
	for _, e := range tree {
		shas = append(shas, e.Sha)
	}
	blobs, err := g.Blobs(shas)
	require.NoError(t, err)
	require.Equal(t, [][]byte{[]byte("= One\n"), []byte(mainText), big}, blobs, "every file is here")

	sha, err := g.Commit(ctx, token, CommitRequest{Branch: "main", ExpectedHead: head, Message: "Edit", Author: Signature{"Ann", "ann@example.com"},
		Actions: []Action{{Kind: ActionUpdate, Path: "/main.typ", Content: []byte("v2\n")}, {Kind: ActionMove, Path: "/video.bin", PreviousPath: "/media/video.bin"}}})
	require.NoError(t, err)
	require.Equal(t, sha, run(bare, "rev-parse", "main"))
	require.Equal(t, "Ann <ann@example.com> / Zwiebelfisch <z@x>", run(bare, "log", "-1", "--format=%an <%ae> / %cn <%ce>", "main"))
	require.Equal(t, "chapters/one.typ\nmain.typ\nvideo.bin", run(bare, "ls-tree", "-r", "--name-only", "main"))
	run(bare, "fsck", "--strict")

	stale := head
	run(work, "pull", "-q", bare, "main")
	require.NoError(t, os.WriteFile(filepath.Join(work, "main.typ"), []byte("theirs\n"), 0o644))
	run(work, "commit", "-q", "-am", "theirs")
	run(work, "push", "-q", bare, "main")
	_, err = g.Commit(ctx, token, CommitRequest{Branch: "main", ExpectedHead: stale, Message: "stale", Author: Signature{"Ann", "a@x"},
		Actions: []Action{{Kind: ActionDelete, Path: "/main.typ"}}})
	require.ErrorIs(t, err, ErrConflict)

	g.mu.Lock()
	g.writes = upkeepEvery - 1
	g.upkeep()
	g.mu.Unlock()
	require.True(t, strings.HasPrefix(run(dir, "count-objects"), "0 objects"), "no loose objects after the upkeep")
	head, err = g.Head(ctx, token, "main")
	require.NoError(t, err)
	blobs, err = g.Blobs([]string{blobSha([]byte("theirs\n"))})
	require.NoError(t, err, "after the repack")
	require.Equal(t, "theirs\n", string(blobs[0]))
	_, err = g.Commit(ctx, token, CommitRequest{Branch: "main", ExpectedHead: head, Message: "after upkeep", Author: Signature{"Ann", "a@x"},
		Actions: []Action{{Kind: ActionCreate, Path: "/after.typ", Content: []byte("x")}}})
	require.NoError(t, err)
	run(dir, "-c", "fetch.negotiationAlgorithm=noop", "fsck", "--connectivity-only", "--no-dangling")

	// GitLab refuses a push in a hook (a protected branch): its refusal, not "could not be reached"
	hook := filepath.Join(bare, "hooks", "pre-receive")
	require.NoError(t, os.WriteFile(hook, []byte("#!/bin/sh\necho 'GitLab: You are not allowed to push code to protected branches on this project.' >&2\nexit 1\n"), 0o755))
	head, err = g.Head(ctx, token, "main")
	require.NoError(t, err)
	_, err = g.Commit(ctx, token, CommitRequest{Branch: "main", ExpectedHead: head, Message: "refused", Author: Signature{"Ann", "a@x"},
		Actions: []Action{{Kind: ActionDelete, Path: "/after.typ"}}})
	require.ErrorAs(t, err, new(*APIError))
	require.True(t, strings.HasPrefix(failureMessage(err), "GitLab refused the push: "), failureMessage(err))
}

// handlerTransport sends every request to a handler, in-process (no port).
type handlerTransport struct{ h http.Handler }

func (t handlerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	in := r.Clone(r.Context())
	in.RequestURI = r.URL.RequestURI()
	in.RemoteAddr = "127.0.0.1:1"
	if in.Body == nil {
		in.Body = http.NoBody
	}
	rec := httptest.NewRecorder()
	t.h.ServeHTTP(rec, in)
	res := rec.Result()
	res.Request = r
	return res, nil
}
