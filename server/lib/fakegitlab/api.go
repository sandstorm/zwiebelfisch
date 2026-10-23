package fakegitlab

// What the fake answers besides its sign-in (signin.go's /.well-known/…, /oauth/…):
//
//	git smart HTTP at /<project>.git/   info/refs, git-upload-pack, git-receive-pack (basic auth oauth2:<token>;
//	                                    a push also needs Developer and the right to push to the branch)
//	GET /api/v4/projects/<id or url-encoded path>                              the project
//	GET /api/v4/projects/<…>/repository/branches/<branch>                      its head, protected, can_push
//	                                                                           (auto-created with SetAutoBranches)
//	GET /api/v4/projects/<…>/members/all/<user id>                             a member's access level (404: none)
//
// REST takes the token as Bearer. Errors are GitLab's JSON {"message": …} with its status codes.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-git/go-git/v6/backend"
	"github.com/go-git/go-git/v6/storage"
)

// ServeHTTP answers git, the API and the sign-in, as GitLab at URL would.
func (g *GitLab) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.HasPrefix(r.URL.Path, "/oauth/") || strings.HasPrefix(r.URL.Path, "/.well-known/"):
		g.signIn.ServeHTTP(w, r)
	case strings.HasPrefix(r.URL.Path, "/"+g.project+".git/"):
		g.serveGit(w, r)
	default:
		g.serveAPI(w, r)
	}
}

// serveGit answers git over smart HTTP for the user whose token the basic auth carries.
func (g *GitLab) serveGit(w http.ResponseWriter, r *http.Request) {
	name, token, _ := r.BasicAuth()
	user, ok := g.signIn.holder(token)
	if name != "oauth2" || !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="GitLab"`)
		http.Error(w, "HTTP Basic: Access denied", http.StatusUnauthorized)
		return
	}
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	service := path.Base(r.URL.Path)
	if service == "refs" {
		service = r.URL.Query().Get("service")
	}
	push := r.Method == http.MethodPost && service == "git-receive-pack"
	branch := ""
	if push {
		branch = pushedBranch(body)
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	g.requests = append(g.requests, "GIT "+service)
	if push {
		if g.unreachable[branch] {
			panic(http.ErrAbortHandler) // the connection drops without an answer
		}
		if !g.mayPush(user.ID, branch) {
			http.Error(w, "You are not allowed to push code to this project.", http.StatusForbidden)
			return
		}
		if race := g.race; race != nil {
			g.race = nil
			g.push(upstream, branch, race.files, race.message)
		}
		if f := g.failure; f != nil {
			g.failure = nil
			http.Error(w, f.message, f.status)
			return
		}
	}
	backend.New(loader{g.repo.Storer}).ServeHTTP(w, r)
}

// loader hands the backend the one repository.
type loader struct{ s storage.Storer }

func (l loader) Load(*url.URL) (storage.Storer, error) { return l.s, nil }

// pushedBranch is the branch the first ref update of a receive-pack request names ("": none).
func pushedBranch(body []byte) string {
	m := refUpdate.FindSubmatch(body)
	if m == nil {
		return ""
	}
	return string(m[1])
}

var refUpdate = regexp.MustCompile(`[0-9a-f]{40} [0-9a-f]{40} refs/heads/([^\x00\n]+)`)

// mayPush is whether user may push to branch. Called with mu held.
func (g *GitLab) mayPush(user int, branch string) bool {
	level := g.level(user)
	if level < Developer {
		return false
	}
	rule := g.protection(branch)
	if rule == nil {
		return true
	}
	for _, u := range rule.users {
		if u == user {
			return true
		}
	}
	return rule.pushLevel > NoAccess && level >= rule.pushLevel
}

// level is user's access level. Called with mu held.
func (g *GitLab) level(user int) int {
	if level, set := g.access[user]; set {
		return level
	}
	return Developer
}

// serveAPI answers the REST endpoints for the user whose token is the Bearer.
func (g *GitLab) serveAPI(w http.ResponseWriter, r *http.Request) {
	token, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	user, ok := g.signIn.holder(token)
	if !ok {
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
	g.mu.Lock()
	defer g.mu.Unlock()
	request := r.Method + " " + tail
	if r.URL.RawQuery != "" {
		request += "?" + r.URL.RawQuery
	}
	g.requests = append(g.requests, request)
	segments := strings.Split(strings.TrimPrefix(tail, "/"), "/")
	for i, s := range segments {
		segments[i], _ = url.PathUnescape(s)
	}
	switch {
	case r.Method != http.MethodGet:
		fail(w, http.StatusNotFound, "404 Not Found")
	case tail == "":
		g.projectInfo(w)
	case len(segments) == 3 && segments[0] == "repository" && segments[1] == "branches":
		g.branch(w, segments[2], user.ID)
	case len(segments) == 3 && segments[0] == "members" && segments[1] == "all":
		g.member(w, segments[2])
	default:
		fail(w, http.StatusNotFound, "404 Not Found")
	}
}

const projectID = "1"

func (g *GitLab) projectInfo(w http.ResponseWriter) {
	reply(w, http.StatusOK, map[string]any{
		"id": 1, "path_with_namespace": g.project, "name": path.Base(g.project), "default_branch": "main",
		"web_url": URL + "/" + g.project, "http_url_to_repo": URL + "/" + g.project + ".git",
	})
}

func (g *GitLab) branch(w http.ResponseWriter, name string, user int) {
	if g.head(name).IsZero() && g.autoBranches {
		g.setBranch(name, g.head("main"))
	}
	sha := g.head(name)
	if sha.IsZero() {
		fail(w, http.StatusNotFound, "404 Branch Not Found")
		return
	}
	reply(w, http.StatusOK, map[string]any{
		"name": name, "commit": map[string]any{"id": sha.String()},
		"protected": g.protection(name) != nil, "can_push": g.mayPush(user, name),
	})
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
	level := g.level(n)
	if !ok || level == NoAccess {
		fail(w, http.StatusNotFound, "404 Not found")
		return
	}
	reply(w, http.StatusOK, map[string]any{"id": u.ID, "username": u.Username, "name": u.Name, "state": "active", "access_level": level})
}

func reply(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func fail(w http.ResponseWriter, status int, message string) {
	reply(w, status, map[string]string{"message": message})
}

// Client is an http.Client that answers requests to URL in-process, from g (no port, no network). A push to
// an unreachable branch fails as a dropped connection does; any other host is unknown.
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
			res, err = nil, fmt.Errorf("fakegitlab: %s %s: connection reset by peer", r.Method, r.URL.Redacted())
		}
	}()
	in := r.Clone(r.Context())
	if r.Body != nil {
		body, _ := io.ReadAll(r.Body)
		in.Body = io.NopCloser(bytes.NewReader(body))
	} else {
		in.Body = http.NoBody
	}
	in.RequestURI = r.URL.RequestURI()
	rec := httptest.NewRecorder()
	t.g.ServeHTTP(rec, in)
	res = rec.Result()
	res.Request = r
	return res, nil
}
