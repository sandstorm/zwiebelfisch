package gitlab

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// api is GitLab's REST API (v4) of one instance, called with a user's OAuth token (scope read_api). Used by:
//   - access.go: who may edit and push
//   - git.go: a project's path, for a room named by numeric id
type api struct {
	instance string // https://gitlab.example.org
	client   *http.Client
}

// APIError is GitLab's answer to a request it refused (REST, or git over HTTP).
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string { return e.Message }

// get decodes the JSON answer to GET <instance>/api/v4<path> (path escaped) into v; an answer other than
// 2xx is an *APIError.
func (a api) get(ctx context.Context, token, path string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(a.instance, "/")+"/api/v4"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &APIError{Status: res.StatusCode, Message: errorMessage(res)}
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(v); err != nil {
		return fmt.Errorf("GitLab answered GET %s with something else than JSON: %w", path, err)
	}
	return nil
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
