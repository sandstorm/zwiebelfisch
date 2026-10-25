package gitlab

// The start page's view of GitLab (docs/30_configuration/05_deployment.typ), each asked with the user's own
// token; package app mounts them for signed-in members:
//   - ServeProjects    GET  /api/gitlab/projects?search=               the projects the user may edit
//   - ServeBranches    GET  /api/gitlab/projects/{project}/branches    the branches, and the default one
//   - ServeFolders     GET  /api/gitlab/projects/{project}/folders?ref= the project folders and templates
//   - ServeNewFolder   POST /api/gitlab/projects/{project}/folders     a new project folder from a template
//
// A new folder's room starts with the template's files as unsaved changes (seeded when the room first
// opens); nothing reaches GitLab before a save.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"
	"sync"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
)

// Project is a GitLab project as the start page lists it.
type Project struct {
	Path        string `json:"path"` // group/sub/project
	Name        string `json:"name"` // Group / Sub / Project
	Description string `json:"description,omitempty"`
}

// Template is a folder whose files a new project folder starts with: `<scope>/_template` (named after its
// scope) or `<scope>/_templates/<name>`. It serves the folders below scope.
type Template struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Scope string `json:"scope"` // "/" for the repository's
}

// Folders are a branch's project folders (holding a main.typ, no part starting with "_"; "/" for the
// root's) and templates, sorted.
type Folders struct {
	Folders   []string   `json:"folders"`
	Templates []Template `json:"templates"`
}

const (
	maxProjects = 20
	maxBranches = 100
	// maxSeeds is how many new folders wait for their room to open at once; more forget the oldest
	maxSeeds = 100
	// emptyTemplate is the main.typ of a new folder without a template
	emptyTemplate = "= Untitled\n\nStart writing here.\n"
)

// ServeProjects answers the projects whose name or path match ?search= that user may edit (Developer or
// more), most recently active first.
func (x *Rooms) ServeProjects(w http.ResponseWriter, r *http.Request, user collab.User) {
	q := url.Values{
		"membership": {"true"}, "min_access_level": {fmt.Sprint(developer)}, "simple": {"true"},
		"search": {r.URL.Query().Get("search")}, "search_namespaces": {"true"}, "order_by": {"last_activity_at"},
		"per_page": {fmt.Sprint(maxProjects)},
	}
	var found []struct {
		Path        string `json:"path_with_namespace"`
		Name        string `json:"name_with_namespace"`
		Description string `json:"description"`
	}
	if !x.askGitLab(w, r, user, "/projects?"+q.Encode(), &found) {
		return
	}
	projects := make([]Project, 0, len(found))
	for _, p := range found {
		projects = append(projects, Project{Path: p.Path, Name: p.Name, Description: p.Description})
	}
	writeJSON(w, projects)
}

// ServeBranches answers the project's branches matching ?search= (at most maxBranches) and its default
// branch.
func (x *Rooms) ServeBranches(w http.ResponseWriter, r *http.Request, user collab.User) {
	base := "/projects/" + url.PathEscape(r.PathValue("project"))
	var project struct {
		DefaultBranch string `json:"default_branch"`
	}
	if !x.askGitLab(w, r, user, base, &project) {
		return
	}
	q := url.Values{"search": {r.URL.Query().Get("search")}, "per_page": {fmt.Sprint(maxBranches)}}
	var found []struct {
		Name string `json:"name"`
	}
	if !x.askGitLab(w, r, user, base+"/repository/branches?"+q.Encode(), &found) {
		return
	}
	branches := []string{}
	for _, b := range found {
		branches = append(branches, b.Name)
	}
	writeJSON(w, map[string]any{"default": project.DefaultBranch, "branches": branches})
}

// ServeFolders answers the project folders and templates of the branch ?ref=, from the project's clone.
func (x *Rooms) ServeFolders(w http.ResponseWriter, r *http.Request, user collab.User) {
	entries, ok := x.branchTree(w, r, user, r.PathValue("project"), r.URL.Query().Get("ref"))
	if ok {
		writeJSON(w, projectFolders(entries))
	}
}

// ServeNewFolder takes {ref, path, template} (template: a Template's path, "" for one main.typ), checks
// that user may edit the project and that path is a new folder of the branch, keeps the template's files
// for the folder's room, and answers {room}. The room starts with them as unsaved changes when it first
// opens.
func (x *Rooms) ServeNewFolder(w http.ResponseWriter, r *http.Request, user collab.User) {
	var body struct{ Ref, Path, Template string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		http.Error(w, "Expected {ref, path, template}", http.StatusBadRequest)
		return
	}
	project := r.PathValue("project")
	room := fmt.Sprintf("%s%s@%s:%s", x.prefix, project, body.Ref, body.Path)
	if _, _, dir, ok := x.parseRoomName(room); !ok || dir == "" {
		http.Error(w, fmt.Sprintf("%q is no folder a project can be in (e.g. /2026/q3).", body.Path), http.StatusBadRequest)
		return
	}
	a, err := x.access(r.Context(), user, project, body.Ref, true)
	if err != nil || !a.Edit {
		if err == nil {
			err = x.notEditor(project, a)
		}
		http.Error(w, failureMessage(err), http.StatusForbidden)
		return
	}
	entries, ok := x.branchTree(w, r, user, project, body.Ref)
	if !ok {
		return
	}
	files, err := x.templateFiles(project, entries, body.Path, body.Template)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	x.seeds.put(room, files)
	writeJSON(w, map[string]string{"room": room})
}

// projectFolders are the project folders and templates among a branch's files.
func projectFolders(entries []TreeEntry) Folders {
	folders := map[string]bool{}
	templates := map[string]Template{}
	for _, e := range entries {
		parts := strings.Split(strings.TrimPrefix(e.Path, "/"), "/")
		dirs := parts[:len(parts)-1]
		if i := slices.IndexFunc(dirs, func(p string) bool { return p == "_template" || p == "_templates" }); i >= 0 {
			if t, ok := template(dirs, i); ok {
				templates[t.Path] = t
			}
			continue
		}
		if parts[len(parts)-1] == "main.typ" && !slices.ContainsFunc(dirs, func(p string) bool { return strings.HasPrefix(p, "_") }) {
			folders["/"+strings.Join(dirs, "/")] = true
		}
	}
	f := Folders{Folders: slices.Sorted(maps.Keys(folders)), Templates: []Template{}}
	for _, p := range slices.Sorted(maps.Keys(templates)) {
		f.Templates = append(f.Templates, templates[p])
	}
	return f
}

// template is the template of a file in dirs, whose part i is _template or _templates.
func template(dirs []string, i int) (Template, bool) {
	scope := "/" + strings.Join(dirs[:i], "/")
	if dirs[i] == "_template" {
		name := "Template"
		if i > 0 {
			name = dirs[i-1]
		}
		return Template{Name: name, Path: path.Join(scope, "_template"), Scope: scope}, true
	}
	if i+1 >= len(dirs) {
		return Template{}, false // a file right in _templates/
	}
	return Template{Name: dirs[i+1], Path: path.Join(scope, "_templates", dirs[i+1]), Scope: scope}, true
}

// templateFiles are the files of a new folder dir from the template at templatePath ("": emptyTemplate),
// read from the branch's files entries: an error when dir has files already, or templatePath is no
// template of entries that serves dir.
func (x *Rooms) templateFiles(project string, entries []TreeEntry, dir, templatePath string) (map[string][]byte, error) {
	if slices.ContainsFunc(entries, func(e TreeEntry) bool { return strings.HasPrefix(e.Path, dir+"/") }) {
		return nil, fmt.Errorf("%s exists already: open it instead", dir)
	}
	if templatePath == "" {
		return map[string][]byte{dir + "/main.typ": []byte(emptyTemplate)}, nil
	}
	served := slices.ContainsFunc(projectFolders(entries).Templates, func(t Template) bool {
		parent := path.Dir(dir)
		return t.Path == templatePath && (t.Scope == "/" || parent == t.Scope || strings.HasPrefix(parent, t.Scope+"/"))
	})
	if !served {
		return nil, fmt.Errorf("%s is no template for %s", templatePath, dir)
	}
	var paths, shas []string
	for _, e := range entries {
		if rest, ok := strings.CutPrefix(e.Path, templatePath+"/"); ok {
			paths, shas = append(paths, dir+"/"+rest), append(shas, e.Sha)
		}
	}
	if len(paths) > maxPulledIn {
		return nil, fmt.Errorf("%s has more than %d files", templatePath, maxPulledIn)
	}
	contents, err := x.repository(project).Blobs(shas)
	if err != nil {
		return nil, errors.New(failureMessage(err))
	}
	files := map[string][]byte{}
	for i, p := range paths {
		files[p] = contents[i]
	}
	return files, nil
}

// branchTree is every file of project's branch ref, fetched with user's token; on failure it answered w.
func (x *Rooms) branchTree(w http.ResponseWriter, r *http.Request, user collab.User, project, ref string) ([]TreeEntry, bool) {
	if ref == "" || strings.Contains(ref, ":") {
		http.Error(w, "Name a branch: ?ref=", http.StatusBadRequest)
		return nil, false
	}
	token, err := x.token(r.Context(), user)
	if err != nil {
		http.Error(w, failureMessage(err), http.StatusUnauthorized)
		return nil, false
	}
	repo := x.repository(project)
	head, err := repo.Head(r.Context(), token, ref)
	if err == nil {
		var entries []TreeEntry
		if entries, err = repo.Tree(head); err == nil {
			return entries, true
		}
	}
	http.Error(w, failureMessage(err), statusOf(err))
	return nil, false
}

// askGitLab decodes GitLab's answer to GET path, asked with user's token, into v; on failure it answered w.
func (x *Rooms) askGitLab(w http.ResponseWriter, r *http.Request, user collab.User, path string, v any) bool {
	token, err := x.token(r.Context(), user)
	if err == nil {
		err = api{instance: x.opts.URL, client: x.opts.Client}.get(r.Context(), token, path, v)
	}
	if err != nil {
		http.Error(w, failureMessage(err), statusOf(err))
		return false
	}
	return true
}

// statusOf is the HTTP status of a failure to ask GitLab: GitLab's own refusal, else 502.
func statusOf(err error) int {
	var refused *APIError
	var refusal collab.Refusal
	switch {
	case errors.As(err, &refused) && refused.Status < 500:
		return refused.Status
	case errors.As(err, &refusal):
		return http.StatusUnauthorized
	}
	return http.StatusBadGateway
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// seeds are the files of new folders whose room has not opened yet, by room name (at most maxSeeds).
type seeds struct {
	mu    sync.Mutex
	files map[string]map[string][]byte
	order []string
}

func (s *seeds) put(room string, files map[string][]byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.files == nil {
		s.files = map[string]map[string][]byte{}
	}
	if _, ok := s.files[room]; !ok {
		s.order = append(s.order, room)
	}
	s.files[room] = files
	if len(s.order) > maxSeeds {
		delete(s.files, s.order[0])
		s.order = s.order[1:]
	}
}

// take removes and returns the room's files (nil: none).
func (s *seeds) take(room string) map[string][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	files := s.files[room]
	delete(s.files, room)
	s.order = slices.DeleteFunc(s.order, func(r string) bool { return r == room })
	return files
}

// MayMaintain is whether user is a Maintainer (or Owner) of the room name's project, as GitLab tells them
// (an answer up to a minute old will do): who may pin it for the team.
func (x *Rooms) MayMaintain(ctx context.Context, user collab.User, name string) (bool, error) {
	project, branch, _, ok := x.parseRoomName(name)
	if !ok {
		return false, nil
	}
	a, err := x.access(ctx, user, project, branch, true)
	if err != nil {
		return false, err
	}
	return a.Maintain, nil
}
