package local_test

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/local"
)

const token = "secret-token"

func request(t *testing.T, server, method, path, body, client string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, server+path, strings.NewReader(body))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Zwiebelfisch-Client", client)
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() { _ = res.Body.Close() })
	return res
}

func TestHandlerNeedsTheToken(t *testing.T) {
	f, _ := folder(t)
	h := local.Handler(f, token)
	for _, auth := range []string{"", "Bearer ", "Bearer wrong", token} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/local/project", nil)
		req.Header.Set("Authorization", auth)
		h.ServeHTTP(rec, req)
		require.Equal(t, http.StatusUnauthorized, rec.Code, auth)
	}
}

// On a port (the events stream): it skips where none can be bound (the agent sandbox).
func TestHandlerProjectAndChanges(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("cannot bind a port here: %v", err)
	}
	f, dir := folder(t)
	server := &httptest.Server{Listener: probe, Config: &http.Server{Handler: local.Handler(f, token)}}
	server.Start()
	t.Cleanup(server.Close) // after the responses' bodies are closed (cleanups run last first)

	res := request(t, server.URL, "GET", "/api/local/project", "", "")
	require.Equal(t, http.StatusOK, res.StatusCode)
	var project struct {
		Name, Main string
		Files      map[string][]byte
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&project))
	require.Equal(t, "thesis", project.Name)
	require.Equal(t, "/main.typ", project.Main)
	require.Equal(t, []byte("\x89PNG"), project.Files["/logo.png"])

	events := request(t, server.URL, "GET", "/api/local/events", "", "b")
	require.Equal(t, "application/x-ndjson", events.Header.Get("Content-Type"))
	lines := bufio.NewScanner(events.Body)
	next := func() local.Change {
		require.True(t, lines.Scan())
		var c local.Change
		require.NoError(t, json.Unmarshal(lines.Bytes(), &c))
		return c
	}

	require.Equal(t, http.StatusNoContent, request(t, server.URL, "PUT", "/api/local/files/chapters/intro.typ", "Hello", "a").StatusCode)
	require.Equal(t, local.Change{Kind: "update", Path: "/chapters/intro.typ", Content: []byte("Hello"), By: "a"}, next())
	require.Equal(t, http.StatusNoContent, request(t, server.URL, "POST", "/api/local/rename", `{"from":"/chapters/intro.typ","to":"/intro.typ"}`, "a").StatusCode)
	require.Equal(t, local.Change{Kind: "rename", Path: "/intro.typ", From: "/chapters/intro.typ", By: "a"}, next())
	require.Equal(t, http.StatusNoContent, request(t, server.URL, "DELETE", "/api/local/files/intro.typ", "", "a").StatusCode)
	require.Equal(t, local.Change{Kind: "delete", Path: "/intro.typ", By: "a"}, next())

	write(t, filepath.Join(dir, "main.typ"), "= From vim")
	require.NoError(t, f.Poll())
	require.Equal(t, local.Change{Kind: "update", Path: "/main.typ", Content: []byte("= From vim")}, next())

	refused := request(t, server.URL, "PUT", "/api/local/files/.cache/config", "x", "a")
	require.Equal(t, http.StatusUnprocessableEntity, refused.StatusCode)
	reason, _ := io.ReadAll(refused.Body)
	require.Contains(t, string(reason), "hidden")
	config, err := os.ReadFile(filepath.Join(dir, ".cache", "config"))
	require.NoError(t, err)
	require.Equal(t, "[core]", string(config))

	require.NoError(t, f.Close())
	require.False(t, lines.Scan(), "a closed folder ends the stream")
}
