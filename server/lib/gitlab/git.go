package gitlab

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	git "github.com/go-git/go-git/v6"
	"github.com/go-git/go-git/v6/config"
	"github.com/go-git/go-git/v6/plumbing"
	gitclient "github.com/go-git/go-git/v6/plumbing/client"
	"github.com/go-git/go-git/v6/plumbing/filemode"
	"github.com/go-git/go-git/v6/plumbing/object"
	"github.com/go-git/go-git/v6/plumbing/storer"
	"github.com/go-git/go-git/v6/plumbing/transport"
	githttp "github.com/go-git/go-git/v6/plumbing/transport/http"
	"github.com/go-git/go-git/v6/storage/memory"
)

// gitRepo is a project's Repository: a bare, full git clone (go-git) of the branches its rooms need, shared
// by them, in a folder of its own or in memory; files are read from it. Commits are built from the actions (no
// worktree) and pushed with compare-and-swap on the branch.
//
// The token of a call goes into that call's basic auth (oauth2:<token>) only: never into the clone's files
// (config, remote URL) or an error. Safe for concurrent use: one call at a time.
type gitRepo struct {
	project   string // id or path with namespace
	dir       string // "": in memory
	api       api
	client    *http.Client // git over HTTP: no overall timeout (gitTimeout per call)
	committer Signature

	mu     sync.Mutex
	repo   *git.Repository // nil until the first call; its remote: <instance>/<path>.git
	writes int             // since the last upkeep
}

const (
	remoteName = "origin"
	// gitTimeout bounds one call to GitLab's git
	gitTimeout = 5 * time.Minute
	// upkeepEvery is how many writes (fetches, commits) the clone takes between two repacks
	upkeepEvery = 100
)

func newGitRepo(project, dir string, a api, committer Signature) *gitRepo {
	return &gitRepo{project: project, dir: dir, api: a, client: &http.Client{Transport: a.client.Transport}, committer: committer}
}

func (g *gitRepo) Head(ctx context.Context, token, branch string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.fetch(ctx, token, branch)
}

func (g *gitRepo) Tree(sha string) ([]TreeEntry, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.repo == nil {
		return nil, plumbing.ErrObjectNotFound
	}
	entries, err := g.files(plumbing.NewHash(sha))
	if err != nil {
		return nil, err
	}
	out := make([]TreeEntry, 0, len(entries))
	for p, e := range entries {
		if e.Mode == filemode.Regular || e.Mode == filemode.Executable { // not links, submodules
			out = append(out, TreeEntry{Path: "/" + p, Sha: e.Hash.String()})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (g *gitRepo) Blobs(shas []string) ([][]byte, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.repo == nil {
		return nil, plumbing.ErrObjectNotFound
	}
	out := make([][]byte, len(shas))
	for i, sha := range shas {
		b, err := g.repo.BlobObject(plumbing.NewHash(sha))
		if err != nil {
			return nil, err
		}
		if b.Size > maxBlobSize {
			return nil, errTooLarge
		}
		r, err := b.Reader()
		if err != nil {
			return nil, err
		}
		out[i], err = io.ReadAll(io.LimitReader(r, maxBlobSize))
		r.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (g *gitRepo) Commit(ctx context.Context, token string, c CommitRequest) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, gitTimeout)
	defer cancel()
	g.mu.Lock()
	defer g.mu.Unlock()
	if err := g.open(ctx, token); err != nil {
		return "", err
	}
	parent := plumbing.NewHash(c.ExpectedHead)
	if _, err := g.repo.CommitObject(parent); err != nil { // not here (a clone made after the room was)
		if _, err := g.fetch(ctx, token, c.Branch); err != nil {
			return "", err
		}
		if _, err := g.repo.CommitObject(parent); err != nil {
			return "", ErrConflict // the branch moved on without it
		}
	}
	entries, err := g.files(parent)
	if err != nil {
		return "", err
	}
	for _, a := range c.Actions {
		if err := g.apply(entries, a); err != nil {
			return "", err
		}
	}
	root, err := g.writeTree(entries)
	if err != nil {
		return "", err
	}
	now := time.Now()
	sha, err := g.write(&object.Commit{
		Author:       object.Signature{Name: c.Author.Name, Email: c.Author.Email, When: now},
		Committer:    object.Signature{Name: g.committer.Name, Email: g.committer.Email, When: now},
		Message:      c.Message,
		TreeHash:     root,
		ParentHashes: []plumbing.Hash{parent},
	})
	if err != nil {
		return "", err
	}
	ref := plumbing.NewBranchReferenceName(c.Branch)
	err = g.repo.PushContext(ctx, &git.PushOptions{
		RemoteName:        remoteName,
		RefSpecs:          []config.RefSpec{config.RefSpec(sha.String() + ":" + ref.String())},
		RequireRemoteRefs: []config.RefSpec{config.RefSpec(c.ExpectedHead + ":" + ref.String())},
		ClientOptions:     g.auth(token),
	})
	if err != nil {
		// a refusal says why only in words: the branch moved, if it is elsewhere now
		if head, headErr := g.remoteHead(ctx, token, c.Branch); headErr == nil && head != c.ExpectedHead {
			return "", ErrConflict
		}
		return "", pushError(err)
	}
	g.track(c.Branch, sha)
	g.upkeep()
	return sha.String(), nil
}

// open opens (or makes) the clone and its remote. Called with mu held.
func (g *gitRepo) open(ctx context.Context, token string) error {
	if g.repo != nil {
		return nil
	}
	remote, err := g.remoteURL(ctx, token)
	if err != nil {
		return err
	}
	var repo *git.Repository
	if g.dir == "" {
		repo, err = git.Init(memory.NewStorage())
	} else if repo, err = git.PlainInit(g.dir, true); errors.Is(err, git.ErrTargetDirNotEmpty) {
		repo, err = git.PlainOpen(g.dir)
	}
	if err != nil {
		return fmt.Errorf("the clone of %s: %w", g.project, err)
	}
	if err := repo.DeleteRemote(remoteName); err != nil && !errors.Is(err, git.ErrRemoteNotFound) {
		return fmt.Errorf("the clone of %s: %w", g.project, err)
	}
	// the project's path now: a clone made before a rename must not fetch or push where its old path leads
	if _, err := repo.CreateRemote(&config.RemoteConfig{Name: remoteName, URLs: []string{remote}}); err != nil {
		return fmt.Errorf("the clone of %s: %w", g.project, err)
	}
	g.repo = repo
	return nil
}

// remoteURL is the project's git URL: <instance>/<path>.git (for a numeric id, the path GitLab names).
func (g *gitRepo) remoteURL(ctx context.Context, token string) (string, error) {
	p := g.project
	if _, err := strconv.ParseUint(p, 10, 64); err == nil {
		var project struct {
			Path string `json:"path_with_namespace"`
		}
		if err := g.api.get(ctx, token, "/projects/"+url.PathEscape(p), &project); err != nil {
			return "", err
		}
		p = project.Path
	}
	return strings.TrimSuffix(g.api.instance, "/") + "/" + p + ".git", nil
}

// fetch fetches branch (everything it holds) and returns its head. Called with mu held.
func (g *gitRepo) fetch(ctx context.Context, token, branch string) (string, error) {
	if err := g.open(ctx, token); err != nil {
		return "", err
	}
	ref := plumbing.NewBranchReferenceName(branch)
	opts := &git.FetchOptions{
		RemoteName: remoteName, Tags: plumbing.NoTags, Force: true, ClientOptions: g.auth(token),
		RefSpecs: []config.RefSpec{config.RefSpec("+" + ref.String() + ":" + tracking(branch).String())},
	}
	switch err := g.repo.FetchContext(ctx, opts); {
	case errors.Is(err, git.ErrRemoteRefNotFound) || errors.Is(err, transport.ErrEmptyRemoteRepository):
		return "", &APIError{Status: http.StatusNotFound, Message: fmt.Sprintf("GitLab has no branch %s in %s", branch, g.project)}
	case err != nil && !errors.Is(err, git.NoErrAlreadyUpToDate):
		return "", remoteError(err)
	}
	head, err := g.repo.Reference(tracking(branch), true)
	if err != nil {
		return "", err
	}
	g.upkeep()
	return head.Hash().String(), nil
}

// remoteHead asks GitLab where branch is now (no fetch). Called with mu held.
func (g *gitRepo) remoteHead(ctx context.Context, token, branch string) (string, error) {
	remote, err := g.repo.Remote(remoteName)
	if err != nil {
		return "", err
	}
	refs, err := remote.ListContext(ctx, &git.ListOptions{ClientOptions: g.auth(token)})
	if err != nil {
		return "", err
	}
	for _, r := range refs {
		if r.Name() == plumbing.NewBranchReferenceName(branch) {
			return r.Hash().String(), nil
		}
	}
	return "", fmt.Errorf("no branch %s", branch)
}

// auth are the client options of one call: the token as basic auth.
func (g *gitRepo) auth(token string) []gitclient.Option {
	return []gitclient.Option{gitclient.WithHTTPClient(g.client), gitclient.WithHTTPAuth(&githttp.BasicAuth{Username: "oauth2", Password: token})}
}

// remoteError is err as GitLab's refusal (an *APIError), when it is one.
func remoteError(err error) error {
	var refused *githttp.Err
	if errors.As(err, &refused) {
		message := refused.Reason
		if message == "" {
			message = fmt.Sprintf("%d %s", refused.Status, http.StatusText(refused.Status))
		}
		return &APIError{Status: refused.Status, Message: message}
	}
	return err
}

// pushError is a failed push as GitLab's refusal (an *APIError), unless GitLab could not be reached.
func pushError(err error) error {
	var unreachable *url.Error
	if err = remoteError(err); errors.As(err, new(*APIError)) || errors.As(err, &unreachable) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return &APIError{Status: http.StatusForbidden, Message: "GitLab refused the push: " + err.Error()}
}

func tracking(branch string) plumbing.ReferenceName {
	return plumbing.NewRemoteReferenceName(remoteName, branch)
}

// track records that branch is at sha (just pushed). Called with mu held.
func (g *gitRepo) track(branch string, sha plumbing.Hash) {
	_ = g.repo.Storer.SetReference(plumbing.NewHashReference(tracking(branch), sha))
}

// upkeep repacks the clone on disk every upkeepEvery writes: one pack instead of one per fetch, and no
// loose objects (what failed pushes left goes). Called with mu held.
func (g *gitRepo) upkeep() {
	if g.writes++; g.writes < upkeepEvery || g.dir == "" {
		return
	}
	g.writes = 0
	if err := g.repo.RepackObjects(&git.RepackConfig{}); err != nil {
		return // packs stay as they are; the next upkeep tries again
	}
	loose, ok := g.repo.Storer.(storer.LooseObjectStorer)
	if !ok {
		return
	}
	var hashes []plumbing.Hash
	_ = loose.ForEachObjectHash(func(h plumbing.Hash) error { hashes = append(hashes, h); return nil })
	for _, h := range hashes { // all reachable ones are in the new pack
		_ = loose.DeleteLooseObject(h)
	}
	repo, err := git.PlainOpen(g.dir) // forgets the packs it knew
	if err != nil {
		repo = nil // the next call opens it
	}
	g.repo = repo
}

// files flattens commit's tree to path → entry ("chapters/a.typ"), every entry but folders. Called with mu
// held.
func (g *gitRepo) files(commit plumbing.Hash) (map[string]object.TreeEntry, error) {
	c, err := g.repo.CommitObject(commit)
	if err != nil {
		return nil, err
	}
	t, err := c.Tree()
	if err != nil {
		return nil, err
	}
	out := map[string]object.TreeEntry{}
	return out, g.flatten(t, "", out)
}

func (g *gitRepo) flatten(t *object.Tree, prefix string, out map[string]object.TreeEntry) error {
	for _, e := range t.Entries {
		p := prefix + e.Name
		if e.Mode != filemode.Dir {
			out[p] = e
			continue
		}
		sub, err := g.repo.TreeObject(e.Hash)
		if err != nil {
			return err
		}
		if err := g.flatten(sub, p+"/", out); err != nil {
			return err
		}
	}
	return nil
}

// apply applies one action to entries.
func (g *gitRepo) apply(entries map[string]object.TreeEntry, a Action) error {
	p := strings.TrimPrefix(a.Path, "/")
	if a.Kind != ActionDelete && !gitPath(p) {
		return fmt.Errorf("%s %w", a.Path, errBadPath)
	}
	switch a.Kind {
	case ActionCreate, ActionUpdate:
		h, err := g.writeBlob(a.Content)
		if err != nil {
			return err
		}
		mode := filemode.Regular
		if old, ok := entries[p]; ok && old.Mode == filemode.Executable {
			mode = old.Mode
		}
		entries[p] = object.TreeEntry{Name: path.Base(p), Mode: mode, Hash: h}
	case ActionDelete:
		delete(entries, p)
	case ActionMove:
		prev := strings.TrimPrefix(a.PreviousPath, "/")
		e, ok := entries[prev]
		if !ok {
			return fmt.Errorf("no file %s to move", a.PreviousPath)
		}
		delete(entries, prev)
		if a.Content != nil {
			h, err := g.writeBlob(a.Content)
			if err != nil {
				return err
			}
			e.Hash = h
		}
		e.Name = path.Base(p)
		entries[p] = e
	default:
		return fmt.Errorf("action %q", a.Kind)
	}
	return nil
}

// gitPath is whether git takes p ("chapters/a.typ") as a file's path: no part empty, ".", ".." or ".git".
func gitPath(p string) bool {
	for _, part := range strings.Split(p, "/") {
		if part == "" || part == "." || part == ".." || strings.EqualFold(part, ".git") {
			return false
		}
	}
	return true
}

func (g *gitRepo) writeBlob(content []byte) (plumbing.Hash, error) {
	o := g.repo.Storer.NewEncodedObject()
	o.SetType(plumbing.BlobObject)
	w, err := o.Writer()
	if err != nil {
		return plumbing.ZeroHash, err
	}
	if _, err := w.Write(content); err != nil {
		return plumbing.ZeroHash, err
	}
	if err := w.Close(); err != nil {
		return plumbing.ZeroHash, err
	}
	return g.repo.Storer.SetEncodedObject(o)
}

func (g *gitRepo) write(o interface {
	Encode(plumbing.EncodedObject) error
}) (plumbing.Hash, error) {
	encoded := g.repo.Storer.NewEncodedObject()
	if err := o.Encode(encoded); err != nil {
		return plumbing.ZeroHash, err
	}
	return g.repo.Storer.SetEncodedObject(encoded)
}

// writeTree writes the trees of entries and returns the root's id; errBadPath when a file is where a folder is.
func (g *gitRepo) writeTree(entries map[string]object.TreeEntry) (plumbing.Hash, error) {
	type dir struct {
		files map[string]object.TreeEntry
		dirs  map[string]*dir
	}
	newDir := func() *dir { return &dir{map[string]object.TreeEntry{}, map[string]*dir{}} }
	root := newDir()
	for p, e := range entries {
		d := root
		parts := strings.Split(p, "/")
		for _, part := range parts[:len(parts)-1] {
			if _, clash := d.files[part]; clash {
				return plumbing.ZeroHash, fmt.Errorf("/%s %w", p, errBadPath)
			}
			if d.dirs[part] == nil {
				d.dirs[part] = newDir()
			}
			d = d.dirs[part]
		}
		name := parts[len(parts)-1]
		if d.dirs[name] != nil {
			return plumbing.ZeroHash, fmt.Errorf("/%s %w", p, errBadPath)
		}
		d.files[name] = e
	}
	var write func(d *dir) (plumbing.Hash, error)
	write = func(d *dir) (plumbing.Hash, error) {
		t := &object.Tree{}
		for name, e := range d.files {
			e.Name = name
			t.Entries = append(t.Entries, e)
		}
		for name, sub := range d.dirs {
			h, err := write(sub)
			if err != nil {
				return plumbing.ZeroHash, err
			}
			t.Entries = append(t.Entries, object.TreeEntry{Name: name, Mode: filemode.Dir, Hash: h})
		}
		sort.Sort(object.TreeEntrySorter(t.Entries))
		return g.write(t)
	}
	return write(root)
}
