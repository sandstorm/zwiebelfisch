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
	"strings"
)

// project is a Repository on a GitLab instance (REST API v4), for one project. Hidden: URLs and their
// encoding, the token, pagination, base64, and the branch check GitLab lacks.
type project struct {
	api    string // …/api/v4/projects/<id or path, encoded>
	token  string
	client *http.Client
}

func newProject(instance, token, id string, client *http.Client) *project {
	return &project{
		api:    strings.TrimSuffix(instance, "/") + "/api/v4/projects/" + url.PathEscape(id),
		token:  token,
		client: client,
	}
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
