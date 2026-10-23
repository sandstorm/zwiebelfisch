// Package fakegitlab is an in-memory GitLab for tests and the demo playground: one project as a git
// repository (its branches and commits), its members and protected branches, and a sign-in.
//
// GitLab answers, as an http.Handler, what a GitLab client asks for one project:
//   - git over smart HTTP at URL/<project>.git (go-git's server)
//   - the REST endpoints (API v4) of api.go
//   - the sign-in of signin.go
//
// Client serves it all in-process, without network, ports or secrets. Every request needs a user's access
// token as its sign-in issues them (TokenOf): Bearer for REST, basic auth oauth2:<token> for git. A test
// also plays GitLab's other users and failures:
//   - a colleague's push (Push, PushBeforeNextCommit)
//   - a failing push, an unreachable branch (FailNextCommit, SetUnreachable)
//   - who may do what (SetAccess, Protect)
//
// Everyone who signs in is a Developer unless told otherwise.
package fakegitlab

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"sync"
	"time"

	git "github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/plumbing"
	"github.com/go-git/go-git/v6/plumbing/filemode"
	"github.com/go-git/go-git/v6/plumbing/object"
	"github.com/go-git/go-git/v6/storage/memory"
)

// URL is the instance the fake plays; Client answers requests to it.
const URL = "https://gitlab.test"

// Files are a commit's files by absolute project path ("/chapters/a.typ"). In a change, nil deletes.
type Files = map[string][]byte

// Commit is one commit of the fake repository.
type Commit struct {
	SHA    string
	Parent string // "" for the first commit
	// Message as sent, trailers included.
	Message           string
	Author, Committer Author
	Files             Files
}

// Author is a commit's author or committer.
type Author struct{ Name, Email string }

// GitLab is the fake instance with its one project. Safe for concurrent use.
type GitLab struct {
	project string
	signIn  *IdentityProvider

	mu           sync.Mutex
	repo         *git.Repository // in memory, bare
	requests     []string
	race         *race
	failure      *failure
	unreachable  map[string]bool
	autoBranches bool
	access       map[int]int // user id → access level (unset: Developer)
	protected    []protection
}

// protection is a protected branch rule: who may push to branches matching pattern.
type protection struct {
	pattern   string // a branch name; * matches anything
	pushLevel int    // the access level that may push (NoAccess: nobody by level)
	users     []int  // and these users
}

// GitLab's access levels.
const (
	NoAccess   = 0
	Guest      = 10
	Reporter   = 20
	Developer  = 30
	Maintainer = 40
)

type race struct {
	files   Files
	message string
}

type failure struct {
	status  int
	message string
}

// New returns a GitLab whose project (path with namespace, e.g. "demo/report") has branch main with files.
func New(project string, files Files) *GitLab {
	repo, err := git.Init(memory.NewStorage())
	if err != nil {
		panic(err) // in memory: does not fail
	}
	g := &GitLab{
		project: project, signIn: NewIdentityProvider(URL, "/oauth/authorize"), repo: repo,
		unreachable: map[string]bool{}, access: map[int]int{},
	}
	g.push("main", files, "Initial commit")
	_ = repo.Storer.SetReference(plumbing.NewSymbolicReference(plumbing.HEAD, plumbing.NewBranchReferenceName("main")))
	return g
}

var upstream = Author{Name: "Upstream", Email: "upstream@test"}

// IdentityProvider is the fake's sign-in, with issuer URL. Its page (the authorization endpoint) is
// /oauth/authorize on the host that sent the browser there: whoever serves the fake to browsers mounts it.
func (g *GitLab) IdentityProvider() *IdentityProvider { return g.signIn }

// TokenOf is an access token of the user named name (an account, created if new), as their sign-in would
// get one.
func (g *GitLab) TokenOf(name string) string { return g.signIn.issue(name) }

// SetAccess gives the user named name (an account, created if new) access level to the project (NoAccess:
// not a member).
func (g *GitLab) SetAccess(name string, level int) User {
	u := g.signIn.SignIn(name)
	g.mu.Lock()
	defer g.mu.Unlock()
	g.access[u.ID] = level
	return u
}

// Protect protects the branches matching pattern (a name, * matching anything): only members with
// pushLevel or more, and the users named, may push.
func (g *GitLab) Protect(pattern string, pushLevel int, users ...string) {
	rule := protection{pattern: pattern, pushLevel: pushLevel}
	for _, name := range users {
		rule.users = append(rule.users, g.signIn.SignIn(name).ID)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.protected = append(g.protected, rule)
}

// Project is the project's path with namespace.
func (g *GitLab) Project() string { return g.project }

// SetAutoBranches makes branches nobody created yet start at main when first asked for over REST (one fresh
// branch per e2e test, any branch in the playground).
func (g *GitLab) SetAutoBranches(on bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.autoBranches = on
}

// Push commits changes (nil deletes) on branch, as someone pushing would, and returns the new sha. A branch
// nobody created yet starts at main with SetAutoBranches, else from nothing.
func (g *GitLab) Push(branch string, changes Files, message string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.push(branch, changes, message)
}

func (g *GitLab) push(branch string, changes Files, message string) string {
	parent := g.head(branch)
	if parent.IsZero() && g.autoBranches {
		parent = g.head("main")
	}
	sha, err := g.record(parent, changes, message)
	if err != nil {
		panic(err) // in memory: does not fail
	}
	g.setBranch(branch, sha)
	return sha.String()
}

// PushBeforeNextCommit has a colleague push changes to the branch of the next git push just before it is
// received: the race the push's compare-and-swap exists for.
func (g *GitLab) PushBeforeNextCommit(changes Files, message string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.race = &race{changes, message}
}

// FailNextCommit answers the next git push with status and message (after PushBeforeNextCommit's push, if
// any).
func (g *GitLab) FailNextCommit(status int, message string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.failure = &failure{status, message}
}

// SetUnreachable makes git pushes to branch fail as when the network is down (the connection drops
// without an answer), or ends that. Per branch, so an outage leaves the others alone.
func (g *GitLab) SetUnreachable(branch string, down bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if down {
		g.unreachable[branch] = true
	} else {
		delete(g.unreachable, branch)
	}
}

// HasBranch reports whether branch exists.
func (g *GitLab) HasBranch(branch string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return !g.head(branch).IsZero()
}

// Head is the commit branch points at (the zero Commit if there is no such branch).
func (g *GitLab) Head(branch string) Commit {
	g.mu.Lock()
	defer g.mu.Unlock()
	sha := g.head(branch)
	if sha.IsZero() {
		return Commit{}
	}
	c, err := g.repo.CommitObject(sha)
	if err != nil {
		panic(err)
	}
	out := Commit{
		SHA: sha.String(), Message: c.Message, Files: Files{},
		Author: Author{c.Author.Name, c.Author.Email}, Committer: Author{c.Committer.Name, c.Committer.Email},
	}
	if len(c.ParentHashes) > 0 {
		out.Parent = c.ParentHashes[0].String()
	}
	files, err := c.Files()
	if err != nil {
		panic(err)
	}
	_ = files.ForEach(func(f *object.File) error {
		r, err := f.Reader()
		if err != nil {
			return err
		}
		defer r.Close()
		out.Files["/"+f.Name], err = io.ReadAll(r)
		return err
	})
	return out
}

// Text is the files of branch as text.
func (g *GitLab) Text(branch string) map[string]string {
	texts := map[string]string{}
	for path, content := range g.Head(branch).Files {
		texts[path] = string(content)
	}
	return texts
}

// Requests are the requests so far: REST as "METHOD path?query" below the project's URL (as sent,
// escaped), e.g. "GET /repository/branches/main"; git as "GIT <service>", e.g. "GIT git-receive-pack".
func (g *GitLab) Requests() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.requests...)
}

// head is branch's commit (zero: no such branch). Called with mu held.
func (g *GitLab) head(branch string) plumbing.Hash {
	ref, err := g.repo.Reference(plumbing.NewBranchReferenceName(branch), true)
	if err != nil {
		return plumbing.ZeroHash
	}
	return ref.Hash()
}

func (g *GitLab) setBranch(branch string, sha plumbing.Hash) {
	_ = g.repo.Storer.SetReference(plumbing.NewHashReference(plumbing.NewBranchReferenceName(branch), sha))
}

// record writes a commit by upstream of parent's files (zero: none) with changes applied. Called with mu
// held.
func (g *GitLab) record(parent plumbing.Hash, changes Files, message string) (plumbing.Hash, error) {
	files := map[string]plumbing.Hash{} // "chapters/a.typ" → blob
	if !parent.IsZero() {
		c, err := g.repo.CommitObject(parent)
		if err != nil {
			return plumbing.ZeroHash, err
		}
		tree, err := c.Tree()
		if err != nil {
			return plumbing.ZeroHash, err
		}
		walker := object.NewTreeWalker(tree, true, nil)
		for {
			name, e, err := walker.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return plumbing.ZeroHash, err
			}
			if e.Mode != filemode.Dir {
				files[name] = e.Hash
			}
		}
		walker.Close()
	}
	for p, content := range changes {
		p = strings.TrimPrefix(p, "/")
		if content == nil {
			delete(files, p)
			continue
		}
		blob := g.repo.Storer.NewEncodedObject()
		blob.SetType(plumbing.BlobObject)
		w, _ := blob.Writer()
		_, _ = w.Write(content)
		_ = w.Close()
		h, err := g.repo.Storer.SetEncodedObject(blob)
		if err != nil {
			return plumbing.ZeroHash, err
		}
		files[p] = h
	}
	root, err := g.writeTree(files, "")
	if err != nil {
		return plumbing.ZeroHash, err
	}
	when := time.Now()
	c := &object.Commit{
		Author:    object.Signature{Name: upstream.Name, Email: upstream.Email, When: when},
		Committer: object.Signature{Name: upstream.Name, Email: upstream.Email, When: when},
		Message:   message, TreeHash: root,
	}
	if !parent.IsZero() {
		c.ParentHashes = []plumbing.Hash{parent}
	}
	return g.write(c)
}

// writeTree writes the tree of the files below dir ("" or "chapters/") and returns its id.
func (g *GitLab) writeTree(files map[string]plumbing.Hash, dir string) (plumbing.Hash, error) {
	t := &object.Tree{}
	subdirs := map[string]bool{}
	for p, h := range files {
		rest, ok := strings.CutPrefix(p, dir)
		if !ok {
			continue
		}
		if sub, _, nested := strings.Cut(rest, "/"); nested {
			subdirs[sub] = true
		} else {
			t.Entries = append(t.Entries, object.TreeEntry{Name: rest, Mode: filemode.Regular, Hash: h})
		}
	}
	for sub := range subdirs {
		h, err := g.writeTree(files, path.Join(dir, sub)+"/")
		if err != nil {
			return plumbing.ZeroHash, err
		}
		t.Entries = append(t.Entries, object.TreeEntry{Name: sub, Mode: filemode.Dir, Hash: h})
	}
	sort.Sort(object.TreeEntrySorter(t.Entries))
	return g.write(t)
}

func (g *GitLab) write(o interface {
	Encode(plumbing.EncodedObject) error
}) (plumbing.Hash, error) {
	encoded := g.repo.Storer.NewEncodedObject()
	if err := o.Encode(encoded); err != nil {
		return plumbing.ZeroHash, err
	}
	return g.repo.Storer.SetEncodedObject(encoded)
}

// BlobSHA is the git blob id of content (what a tree lists as a file's id).
func BlobSHA(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}
