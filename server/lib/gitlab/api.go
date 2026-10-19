package gitlab

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// project is a Repository on a GitLab instance (REST API v4), for one project.
type project struct {
	instance string // https://gitlab.example.org
	api      string // …/api/v4/projects/<id or path, encoded>
	token    string
	client   *http.Client
}

func newProject(instance, token, id string, client *http.Client) *project {
	instance = strings.TrimSuffix(instance, "/")
	return &project{instance: instance, api: instance + "/api/v4/projects/" + url.PathEscape(id), token: token, client: client}
}

// APIError is GitLab's answer to a request it refused.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

func (p *project) Head(ctx context.Context, branch string) (string, error) {
	var body struct {
		Commit struct {
			ID string `json:"id"`
		} `json:"commit"`
	}
	if _, err := p.json(ctx, http.MethodGet, "/repository/branches/"+url.PathEscape(branch), nil, &body); err != nil {
		return "", err
	}
	return body.Commit.ID, nil
}

func (p *project) Tree(ctx context.Context, sha string) ([]TreeEntry, error) {
	var entries []TreeEntry
	for page := "1"; page != ""; {
		var items []struct {
			Type, Path, ID string
		}
		header, err := p.json(ctx, http.MethodGet, "/repository/tree?ref="+url.QueryEscape(sha)+"&recursive=true&per_page=100&page="+page, nil, &items)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			if item.Type == "blob" {
				entries = append(entries, TreeEntry{Path: "/" + item.Path, Sha: item.ID})
			}
		}
		page = header.Get("X-Next-Page")
	}
	return entries, nil
}

func (p *project) Blob(ctx context.Context, sha string) ([]byte, error) {
	res, err := p.request(ctx, http.MethodGet, "/repository/blobs/"+url.PathEscape(sha)+"/raw", nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	return io.ReadAll(res.Body)
}

// Commit checks the branch's head first: GitLab's commit API cannot require it (only a per-file
// last_commit_id). A push between the check and the commit is refused by GitLab only where it makes an
// action impossible (a file to create exists, one to change is gone); otherwise it lands under the commit,
// which the room notices by its parent.
func (p *project) Commit(ctx context.Context, c CommitRequest) (Commit, error) {
	head, err := p.Head(ctx, c.Branch)
	if err != nil {
		return Commit{}, err
	}
	if head != c.ExpectedHead {
		return Commit{}, ErrConflict
	}
	actions := make([]map[string]string, len(c.Actions))
	for i, a := range c.Actions {
		actions[i] = gitlabAction(a)
	}
	body, _ := json.Marshal(map[string]any{"branch": c.Branch, "commit_message": c.Message, "actions": actions})
	var commit struct {
		ID        string   `json:"id"`
		ParentIDs []string `json:"parent_ids"`
	}
	if _, err := p.json(ctx, http.MethodPost, "/repository/commits", body, &commit); err != nil {
		var refused *APIError
		if errors.As(err, &refused) && refused.Status < 500 {
			if now, headErr := p.Head(ctx, c.Branch); headErr == nil && now != c.ExpectedHead {
				return Commit{}, ErrConflict // refused because of what came in meanwhile
			}
		}
		return Commit{}, err
	}
	result := Commit{Sha: commit.ID}
	if len(commit.ParentIDs) > 0 {
		result.Parent = commit.ParentIDs[0]
	}
	return result, nil
}

// Access asks for the user's role on the project (members/all: inherited ones too) and, for Developers and
// up, the protected branch rules that match branch (wildcards included; a rule lets a role, a user, or a
// group's members push). Reading the rules needs the bot to be at least Maintainer (r).
func (p *project) Access(ctx context.Context, user, branch string) (Access, error) {
	var member struct {
		Level int `json:"access_level"`
	}
	if _, err := p.json(ctx, http.MethodGet, "/members/all/"+url.PathEscape(user), nil, &member); err != nil {
		var refused *APIError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return Access{}, nil
		}
		return Access{}, err
	}
	a := Access{Role: roleName(member.Level), Edit: member.Level >= developer}
	if !a.Edit {
		return a, nil
	}
	protected := false
	for page := "1"; page != ""; {
		var rules []protectedBranch
		header, err := p.json(ctx, http.MethodGet, "/protected_branches?per_page=100&page="+page, nil, &rules)
		if err != nil {
			return Access{}, err
		}
		for _, rule := range rules {
			if !branchPattern(rule.Name).MatchString(branch) {
				continue
			}
			protected = true
			for _, l := range rule.Push {
				if a.Push, err = p.lets(ctx, l, user, member.Level); err != nil || a.Push {
					return a, err
				}
			}
		}
		page = header.Get("X-Next-Page")
	}
	a.Push = !protected
	return a, nil
}

// protectedBranch is a protected branch rule: who may push to the branches its name matches.
type protectedBranch struct {
	Name string       `json:"name"`
	Push []pushAccess `json:"push_access_levels"`
}

// pushAccess lets a user, a group's members, or a role and up push (Level 0: No one).
type pushAccess struct {
	Level int    `json:"access_level"`
	User  *int64 `json:"user_id"`
	Group *int64 `json:"group_id"`
}

// lets is whether one push permission of a rule lets user (of role level) push.
func (p *project) lets(ctx context.Context, l pushAccess, user string, level int) (bool, error) {
	switch {
	case l.User != nil:
		return strconv.FormatInt(*l.User, 10) == user, nil
	case l.Group != nil:
		var member struct{}
		group := &project{api: p.instance + "/api/v4/groups/" + strconv.FormatInt(*l.Group, 10), token: p.token, client: p.client}
		_, err := group.json(ctx, http.MethodGet, "/members/all/"+url.PathEscape(user), nil, &member)
		var refused *APIError
		if errors.As(err, &refused) && refused.Status == http.StatusNotFound {
			return false, nil
		}
		return err == nil, err
	}
	return l.Level > 0 && level >= l.Level, nil
}

const developer = 30

func roleName(level int) string {
	switch {
	case level >= 50:
		return "Owner"
	case level >= 40:
		return "Maintainer"
	case level >= 30:
		return "Developer"
	case level >= 20:
		return "Reporter"
	case level >= 15:
		return "Planner"
	case level >= 10:
		return "Guest"
	case level > 0:
		return "Minimal Access"
	}
	return ""
}

// branchPattern matches the branches a protected branch rule's name covers (`*` is any text, `/` too).
func branchPattern(name string) *regexp.Regexp {
	return regexp.MustCompile("^" + strings.ReplaceAll(regexp.QuoteMeta(name), `\*`, ".*") + "$")
}

func gitlabAction(a Action) map[string]string {
	out := map[string]string{"action": string(a.Kind), "file_path": strings.TrimPrefix(a.Path, "/")}
	if a.Kind == ActionMove {
		out["previous_path"] = strings.TrimPrefix(a.PreviousPath, "/")
	}
	switch {
	case a.Kind == ActionDelete:
	case a.Text:
		out["content"], out["encoding"] = string(a.Content), "text"
	case a.Content != nil:
		out["content"], out["encoding"] = base64.StdEncoding.EncodeToString(a.Content), "base64"
	}
	return out
}

// json makes a request and decodes its JSON answer into v; it returns the answer's headers.
func (p *project) json(ctx context.Context, method, path string, body []byte, v any) (http.Header, error) {
	res, err := p.request(ctx, method, path, body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		return nil, fmt.Errorf("GitLab answered %s %s with something else than JSON: %w", method, path, err)
	}
	return res.Header, nil
}

// request makes a request; an answer other than 2xx is an *APIError.
func (p *project) request(ctx context.Context, method, path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, p.api+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("PRIVATE-TOKEN", p.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 200 && res.StatusCode < 300 {
		return res, nil
	}
	defer res.Body.Close()
	return nil, &APIError{Status: res.StatusCode, Message: errorMessage(res)}
}

// errorMessage is what GitLab says went wrong: its JSON message or error, else the body or status.
func errorMessage(res *http.Response) string {
	text, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	var body struct {
		Message any `json:"message"`
		Error   any `json:"error"`
	}
	if json.Unmarshal(text, &body) == nil {
		for _, m := range []any{body.Message, body.Error} {
			if m != nil {
				if s, ok := m.(string); ok {
					return s
				}
				b, _ := json.Marshal(m)
				return string(b)
			}
		}
	}
	if len(text) > 0 {
		return string(text)
	}
	return res.Status
}
