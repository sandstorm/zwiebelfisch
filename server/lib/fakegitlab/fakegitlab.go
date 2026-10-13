// Package fakegitlab is an in-memory GitLab for tests and the demo playground: one project, its branches,
// commits with full snapshots, its members and protected branches, and a sign-in (signin.go).
//
// GitLab rooms are tested without network, ports or secrets. GitLab answers the REST endpoints (API v4) a
// GitLab client calls for one project (the project, branches, tree, files, blobs, commits with actions; see
// api.go) as an http.Handler, and Client serves them in-process. A test also plays GitLab's other users and
// failures: Push as a colleague, a push racing the next commit, a failing commit, unreachable branches; and
// who may do what: SetAccess (a member's role), Protect (who may push to a branch). Everyone who signs in is
// a Developer unless told otherwise.
//
// Commits follow GitLab's Commits API where a client could notice: start_branch / start_sha / force decide
// the parent and whether an existing branch may be overwritten, last_commit_id is checked per file, and
// without author_name the token's user (the bot) is the author. The message is kept as sent (Co-authored-by
// trailers included). See docs/40_architecture/09_server.typ.
package fakegitlab

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"maps"
	"sync"
)

const (
	// URL is the instance the fake plays; Client answers requests to it.
	URL = "https://gitlab.test"
	// Token is the only token it accepts (as PRIVATE-TOKEN or Bearer): the server's bot token.
	Token = "server-token"
	// BotName and BotEmail are the token's user: the author of commits that name none.
	BotName  = "Typst bot"
	BotEmail = "bot@gitlab.test"
)

// Files are a commit's files by absolute project path ("/chapters/a.typ"). In a change, nil deletes.
type Files = map[string][]byte

// Commit is one commit of the fake repository.
type Commit struct {
	SHA    string
	Parent string // "" for the first commit
	// Message as sent, trailers included.
	Message string
	Author  Author
	Files   Files
}

// Author is a commit's author.
type Author struct{ Name, Email string }

// GitLab is the fake instance with its one project. Safe for concurrent use.
type GitLab struct {
	project string
	signIn  *IdentityProvider

	mu           sync.Mutex
	commits      map[string]*Commit
	branches     map[string]string // branch → commit sha
	counter      int
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
	g := &GitLab{
		project: project, signIn: NewIdentityProvider(URL, "/oauth/authorize"),
		commits: map[string]*Commit{}, branches: map[string]string{}, unreachable: map[string]bool{}, access: map[int]int{},
	}
	g.branches["main"] = g.record("", files, "Initial commit", upstream).SHA
	return g
}

var upstream = Author{Name: "Upstream", Email: "upstream@test"}

// IdentityProvider is the fake's sign-in, with issuer URL. Its page (the authorization endpoint) is
// /oauth/authorize on the host that sent the browser there: whoever serves the fake to browsers mounts it.
func (g *GitLab) IdentityProvider() *IdentityProvider { return g.signIn }

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

// SetAutoBranches makes branches nobody created yet start at main when first asked for (one fresh branch
// per e2e test, any branch in the playground).
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
	parent, ok := g.branches[branch]
	if !ok && g.autoBranches {
		parent = g.branches["main"]
	}
	sha := g.record(parent, changes, message, upstream).SHA
	g.branches[branch] = sha
	return sha
}

// PushBeforeNextCommit has a colleague push changes to the branch of the next commit request just before
// it is handled: the race the branch-level conflict check exists for.
func (g *GitLab) PushBeforeNextCommit(changes Files, message string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.race = &race{changes, message}
}

// FailNextCommit answers the next commit request with status and message (after PushBeforeNextCommit's
// push, if any).
func (g *GitLab) FailNextCommit(status int, message string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.failure = &failure{status, message}
}

// SetUnreachable makes requests about branch (its head, a commit to it) fail as when the network is down
// (the connection drops without an answer), or ends that. Per branch, so an outage leaves the others alone.
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
	_, ok := g.branches[branch]
	return ok
}

// Head is the commit branch points at (the zero Commit if there is no such branch).
func (g *GitLab) Head(branch string) Commit {
	g.mu.Lock()
	defer g.mu.Unlock()
	c := g.commits[g.branches[branch]]
	if c == nil {
		return Commit{}
	}
	copy := *c
	copy.Files = maps.Clone(c.Files)
	return copy
}

// Text is the files of branch as text.
func (g *GitLab) Text(branch string) map[string]string {
	texts := map[string]string{}
	for path, content := range g.Head(branch).Files {
		texts[path] = string(content)
	}
	return texts
}

// Requests are the API requests so far, each as "METHOD path?query" below the project's URL (as sent,
// escaped), e.g. "GET /repository/branches/main".
func (g *GitLab) Requests() []string {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]string(nil), g.requests...)
}

// record stores a commit of parent's files with changes applied. Called with mu held.
func (g *GitLab) record(parent string, changes Files, message string, author Author) *Commit {
	files := Files{}
	if p := g.commits[parent]; p != nil {
		files = maps.Clone(p.Files)
	}
	for path, content := range changes {
		if content == nil {
			delete(files, path)
		} else {
			files[path] = content
		}
	}
	g.counter++
	sum := sha1.Sum(fmt.Appendf(nil, "commit %d %s", g.counter, parent))
	c := &Commit{SHA: hex.EncodeToString(sum[:]), Parent: parent, Message: message, Author: author, Files: files}
	g.commits[c.SHA] = c
	return c
}

// resolve is the commit ref names: a branch or a sha. Called with mu held.
func (g *GitLab) resolve(ref string) *Commit {
	if sha, ok := g.branches[ref]; ok {
		return g.commits[sha]
	}
	return g.commits[ref]
}

// lastCommit is the commit that last changed path, up to c. Called with mu held.
func (g *GitLab) lastCommit(c *Commit, path string) string {
	for {
		parent := g.commits[c.Parent]
		if parent == nil {
			return c.SHA
		}
		before, ok := parent.Files[path]
		if !ok || BlobSHA(before) != BlobSHA(c.Files[path]) {
			return c.SHA
		}
		c = parent
	}
}

// BlobSHA is the git blob id of content (what GitLab's tree lists as a file's id).
func BlobSHA(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}
