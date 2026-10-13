package fakegitlab

// The REST endpoints (API v4) below /api/v4/projects/<id or url-encoded path>:
//
//	GET  ""                             the project
//	GET  /repository/branches/<branch>  a branch and its head (auto-created with SetAutoBranches)
//	GET  /repository/tree               ?ref, path, recursive, per_page, page; x-next-page for the next page
//	GET  /repository/files/<path>       ?ref: base64 content, blob_id, last_commit_id
//	GET  /repository/blobs/<sha>/raw    the bytes
//	POST /repository/commits            branch, commit_message, start_branch, start_sha, force, author_*, actions
//	GET  /repository/commits/<sha>      a commit (its message with trailers, author, parents)
//	GET  /members/all/<user id>         a member's access level (404: not a member)
//	GET  /protected_branches            the protected branch rules (push_access_levels)
//
// The sign-in's endpoints (/.well-known/…, /oauth/…) are signin.go's.
//
// Errors are GitLab's JSON {"message": …} with its status codes and (where a client might match them) texts.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
)

// ServeHTTP answers the API and the sign-in, as GitLab at URL would.
func (g *GitLab) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/oauth/") || strings.HasPrefix(r.URL.Path, "/.well-known/") {
		g.signIn.ServeHTTP(w, r)
		return
	}
	if !authorized(r) {
		fail(w, http.StatusUnauthorized, "401 Unauthorized")
		return
	}
	rest, ok := strings.CutPrefix(r.URL.EscapedPath(), "/api/v4/projects/")
	id, tail, _ := strings.Cut(rest, "/")
	if project, err := url.PathUnescape(id); !ok || err != nil || (project != g.project && project != projectID) {
		fail(w, http.StatusNotFound, "404 Project Not Found")
		return
	}
	if tail != "" {
		tail = "/" + tail
	}
	body, _ := io.ReadAll(r.Body)
	g.mu.Lock()
	defer g.mu.Unlock()
	request := r.Method + " " + tail
	if r.URL.RawQuery != "" {
		request += "?" + r.URL.RawQuery
	}
	g.requests = append(g.requests, request)
	if g.unreachable[branchOf(r.Method, tail, body)] {
		panic(http.ErrAbortHandler) // the connection drops without an answer
	}
	g.route(w, r.Method, tail, r.URL.Query(), body)
}

const projectID = "1"

func authorized(r *http.Request) bool {
	token := r.Header.Get("PRIVATE-TOKEN")
	if bearer, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		token = bearer
	}
	return token == Token
}

func (g *GitLab) route(w http.ResponseWriter, method, tail string, query url.Values, body []byte) {
	segments := strings.Split(strings.TrimPrefix(tail, "/"), "/")
	for i, s := range segments {
		segments[i], _ = url.PathUnescape(s)
	}
	is := func(m string, pattern ...string) bool {
		if m != method || len(pattern) != len(segments) {
			return false
		}
		for i, p := range pattern {
			if p != "*" && p != segments[i] {
				return false
			}
		}
		return true
	}
	switch {
	case is("GET", ""):
		g.projectInfo(w)
	case is("GET", "repository", "branches", "*"):
		g.branch(w, segments[2])
	case is("GET", "repository", "tree"):
		g.tree(w, query)
	case is("GET", "repository", "files", "*"):
		g.file(w, segments[2], query.Get("ref"))
	case is("GET", "repository", "blobs", "*", "raw"):
		g.blob(w, segments[2])
	case is("POST", "repository", "commits"):
		g.commit(w, body)
	case is("GET", "repository", "commits", "*"):
		g.commitInfo(w, segments[2])
	case is("GET", "members", "all", "*"):
		g.member(w, segments[2])
	case is("GET", "protected_branches"):
		g.protectedBranches(w)
	default:
		fail(w, http.StatusNotFound, "404 Not Found")
	}
}

func (g *GitLab) projectInfo(w http.ResponseWriter) {
	reply(w, http.StatusOK, map[string]any{
		"id": 1, "path_with_namespace": g.project, "name": path.Base(g.project), "default_branch": "main",
		"web_url": URL + "/" + g.project,
	})
}

func (g *GitLab) branch(w http.ResponseWriter, name string) {
	if _, ok := g.branches[name]; !ok && g.autoBranches {
		g.branches[name] = g.branches["main"]
	}
	sha, ok := g.branches[name]
	if !ok {
		fail(w, http.StatusNotFound, "404 Branch Not Found")
		return
	}
	reply(w, http.StatusOK, map[string]any{"name": name, "commit": map[string]any{"id": sha}, "protected": g.protection(name) != nil})
}

// protection is the rule protecting branch (nil: none). Called with mu held.
func (g *GitLab) protection(branch string) *protection {
	for i, p := range g.protected {
		if ok, _ := path.Match(p.pattern, branch); ok {
			return &g.protected[i]
		}
	}
	return nil
}

func (g *GitLab) member(w http.ResponseWriter, id string) {
	n, _ := strconv.Atoi(id)
	u, ok := g.signIn.UserByID(n)
	level, set := g.access[n]
	if !set {
		level = Developer
	}
	if !ok || level == NoAccess {
		fail(w, http.StatusNotFound, "404 Not found")
		return
	}
	reply(w, http.StatusOK, map[string]any{"id": u.ID, "username": u.Username, "name": u.Name, "state": "active", "access_level": level})
}

func (g *GitLab) protectedBranches(w http.ResponseWriter) {
	rules := []map[string]any{}
	for i, p := range g.protected {
		levels := []map[string]any{{"access_level": p.pushLevel, "user_id": nil, "group_id": nil}}
		for _, u := range p.users {
			levels = append(levels, map[string]any{"access_level": Maintainer, "user_id": u, "group_id": nil})
		}
		rules = append(rules, map[string]any{"id": i + 1, "name": p.pattern, "push_access_levels": levels})
	}
	reply(w, http.StatusOK, rules)
}

type treeItem struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Path string `json:"path"`
	Mode string `json:"mode"`
}

func (g *GitLab) tree(w http.ResponseWriter, query url.Values) {
	ref := query.Get("ref")
	if ref == "" {
		ref = "main"
	}
	c := g.resolve(ref)
	if c == nil {
		fail(w, http.StatusNotFound, "404 Tree Not Found")
		return
	}
	base := strings.Trim(query.Get("path"), "/")
	recursive := query.Get("recursive") == "true"
	folders := map[string]bool{}
	var blobs []treeItem
	for p, content := range c.Files {
		rel := strings.TrimPrefix(p, "/")
		if base != "" {
			var ok bool
			if rel, ok = strings.CutPrefix(rel, base+"/"); !ok {
				continue
			}
		}
		parts := strings.Split(rel, "/")
		for i := 1; i < len(parts) && (recursive || i == 1); i++ {
			folders[strings.Join(parts[:i], "/")] = true
		}
		if recursive || len(parts) == 1 {
			blobs = append(blobs, treeItem{BlobSHA(content), path.Base(rel), "blob", path.Join(base, rel), "100644"})
		}
	}
	var items []treeItem
	for folder := range folders {
		full := path.Join(base, folder)
		items = append(items, treeItem{BlobSHA([]byte("tree " + full)), path.Base(folder), "tree", full, "040000"})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	sort.Slice(blobs, func(i, j int) bool { return blobs[i].Path < blobs[j].Path })
	items = append(items, blobs...)

	perPage := min(max(number(query.Get("per_page"), 20), 1), 100)
	page := max(number(query.Get("page"), 1), 1)
	from, to := min((page-1)*perPage, len(items)), min(page*perPage, len(items))
	next := ""
	if to < len(items) {
		next = strconv.Itoa(page + 1)
	}
	w.Header().Set("X-Next-Page", next)
	w.Header().Set("X-Total", strconv.Itoa(len(items)))
	reply(w, http.StatusOK, append([]treeItem{}, items[from:to]...))
}

func number(s string, fallback int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return fallback
}

func (g *GitLab) file(w http.ResponseWriter, filePath, ref string) {
	c := g.resolve(ref)
	if c == nil {
		fail(w, http.StatusNotFound, "404 File Not Found")
		return
	}
	content, ok := c.Files["/"+filePath]
	if !ok {
		fail(w, http.StatusNotFound, "404 File Not Found")
		return
	}
	reply(w, http.StatusOK, map[string]any{
		"file_name": path.Base(filePath), "file_path": filePath, "size": len(content), "encoding": "base64",
		"content": base64.StdEncoding.EncodeToString(content), "ref": ref, "blob_id": BlobSHA(content),
		"commit_id": c.SHA, "last_commit_id": g.lastCommit(c, "/"+filePath),
	})
}

func (g *GitLab) blob(w http.ResponseWriter, sha string) {
	for _, c := range g.commits {
		for _, content := range c.Files {
			if BlobSHA(content) == sha {
				w.Header().Set("Content-Type", "application/octet-stream")
				_, _ = w.Write(content)
				return
			}
		}
	}
	fail(w, http.StatusNotFound, "404 Blob Not Found")
}

func (g *GitLab) commitInfo(w http.ResponseWriter, sha string) {
	c := g.commits[sha]
	if c == nil {
		fail(w, http.StatusNotFound, "404 Commit Not Found")
		return
	}
	reply(w, http.StatusOK, commitJSON(c))
}

func commitJSON(c *Commit) map[string]any {
	parents := []string{}
	if c.Parent != "" {
		parents = append(parents, c.Parent)
	}
	title, _, _ := strings.Cut(c.Message, "\n")
	return map[string]any{
		"id": c.SHA, "short_id": c.SHA[:8], "title": title, "message": c.Message, "parent_ids": parents,
		"author_name": c.Author.Name, "author_email": c.Author.Email,
		"committer_name": BotName, "committer_email": BotEmail,
	}
}

type commitRequest struct {
	Branch        string   `json:"branch"`
	CommitMessage string   `json:"commit_message"`
	StartBranch   string   `json:"start_branch"`
	StartSHA      string   `json:"start_sha"`
	Force         bool     `json:"force"`
	AuthorName    string   `json:"author_name"`
	AuthorEmail   string   `json:"author_email"`
	Actions       []action `json:"actions"`
}

type action struct {
	Action       string  `json:"action"`
	FilePath     string  `json:"file_path"`
	PreviousPath string  `json:"previous_path"`
	Content      *string `json:"content"`
	Encoding     string  `json:"encoding"`
	LastCommitID string  `json:"last_commit_id"`
}

// commit creates a commit as GitLab's Commits API does. The parent is start_sha, else start_branch's head,
// else branch's head; starting elsewhere than branch's own head overwrites an existing branch only with force.
func (g *GitLab) commit(w http.ResponseWriter, body []byte) {
	var req commitRequest
	if err := json.Unmarshal(body, &req); err != nil {
		fail(w, http.StatusBadRequest, "400 Bad request - "+err.Error())
		return
	}
	if r := g.race; r != nil {
		g.race = nil
		g.push(req.Branch, r.files, r.message)
	}
	if f := g.failure; f != nil {
		g.failure = nil
		fail(w, f.status, f.message)
		return
	}
	if req.Branch == "" || req.CommitMessage == "" || len(req.Actions) == 0 {
		fail(w, http.StatusBadRequest, "branch, commit_message, actions are missing")
		return
	}
	parent, problem := g.parent(req)
	if problem != "" {
		fail(w, http.StatusBadRequest, problem)
		return
	}
	changes, problem := g.changes(parent, req.Actions)
	if problem != "" {
		fail(w, http.StatusBadRequest, problem)
		return
	}
	author := Author{Name: req.AuthorName, Email: req.AuthorEmail}
	if author.Name == "" {
		author = Author{Name: BotName, Email: BotEmail}
	}
	c := g.record(parent.SHA, changes, req.CommitMessage, author)
	g.branches[req.Branch] = c.SHA
	reply(w, http.StatusCreated, commitJSON(c))
}

func (g *GitLab) parent(req commitRequest) (*Commit, string) {
	_, exists := g.branches[req.Branch]
	elsewhere := req.StartSHA != "" || (req.StartBranch != "" && req.StartBranch != req.Branch)
	switch {
	case req.StartSHA != "" && req.StartBranch != "":
		return nil, "start_branch, start_sha are mutually exclusive"
	case elsewhere && exists && !req.Force:
		return nil, fmt.Sprintf("A branch called '%s' already exists. Switch to that branch in order to make changes", req.Branch)
	case req.StartSHA != "":
		if c := g.commits[req.StartSHA]; c != nil {
			return c, ""
		}
		return nil, "Invalid start_sha " + req.StartSHA
	case req.StartBranch != "":
		if sha, ok := g.branches[req.StartBranch]; ok {
			return g.commits[sha], ""
		}
		return nil, "Invalid start branch " + req.StartBranch
	case !exists:
		return nil, "You can only create or edit files when you are on a branch"
	}
	return g.commits[g.branches[req.Branch]], ""
}

// changes are what actions do to parent's files, applied in order, or why GitLab refuses them.
func (g *GitLab) changes(parent *Commit, actions []action) (Files, string) {
	files := Files{}
	has := func(p string) bool {
		content, changed := files[p]
		if changed {
			return content != nil
		}
		_, ok := parent.Files[p]
		return ok
	}
	for _, a := range actions {
		target, existing := "/"+a.FilePath, "/"+a.FilePath
		if a.Action == "move" {
			existing = "/" + a.PreviousPath
		}
		switch a.Action {
		case "create", "update", "delete", "move":
		default:
			return nil, fmt.Sprintf("Unknown action '%s'", a.Action)
		}
		if (a.Action == "create" || a.Action == "move") && has(target) {
			return nil, "A file with this name already exists"
		}
		if a.Action != "create" && !has(existing) {
			return nil, "A file with this name doesn't exist"
		}
		if a.LastCommitID != "" && a.Action != "create" {
			if _, ok := parent.Files[existing]; ok && g.lastCommit(parent, existing) != a.LastCommitID {
				return nil, "You are attempting to update a file that has changed since you started editing it."
			}
		}
		content, problem := decode(a)
		if problem != "" {
			return nil, problem
		}
		if a.Action == "move" {
			if content == nil {
				content = files[existing]
				if content == nil {
					content = parent.Files[existing]
				}
			}
			files[existing] = nil
		}
		if a.Action == "delete" {
			content = nil
		} else if content == nil {
			content = []byte{}
		}
		files[target] = content
	}
	return files, ""
}

// decode is an action's content as bytes (nil: none sent).
func decode(a action) ([]byte, string) {
	if a.Content == nil {
		return nil, ""
	}
	if a.Encoding == "base64" {
		content, err := base64.StdEncoding.DecodeString(*a.Content)
		if err != nil {
			return nil, "content is not base64"
		}
		return content, ""
	}
	return []byte(*a.Content), ""
}

// branchOf is the branch a request is about (its head, a commit to it), or "".
func branchOf(method, tail string, body []byte) string {
	if name, ok := strings.CutPrefix(tail, "/repository/branches/"); ok && method == "GET" {
		name, _ = url.PathUnescape(name)
		return name
	}
	if tail == "/repository/commits" && method == "POST" {
		var req commitRequest
		_ = json.Unmarshal(body, &req)
		return req.Branch
	}
	return ""
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"message": message})
}

// Client is an http.Client that answers requests to URL in-process, from g (no port, no network). A request
// about an unreachable branch fails as a dropped connection does; any other host is unknown.
func (g *GitLab) Client() *http.Client {
	return &http.Client{Transport: inProcess{g}}
}

type inProcess struct{ g *GitLab }

func (t inProcess) RoundTrip(r *http.Request) (res *http.Response, err error) {
	if r.Body != nil {
		defer r.Body.Close()
	}
	if r.URL.Scheme+"://"+r.URL.Host != URL {
		return nil, fmt.Errorf("fakegitlab: dial %s: no such host", r.URL.Host)
	}
	defer func() {
		if p := recover(); p != nil {
			if p != http.ErrAbortHandler {
				panic(p)
			}
			res, err = nil, fmt.Errorf("fakegitlab: %s %s: connection reset by peer", r.Method, r.URL)
		}
	}()
	in := r.Clone(r.Context())
	if r.Body != nil {
		body, _ := io.ReadAll(r.Body)
		in.Body = io.NopCloser(bytes.NewReader(body))
	} else {
		in.Body = http.NoBody
	}
	rec := httptest.NewRecorder()
	t.g.ServeHTTP(rec, in)
	res = rec.Result()
	res.Request = r
	return res, nil
}
