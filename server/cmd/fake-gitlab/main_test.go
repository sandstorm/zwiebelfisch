package main_test

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/testutil"
)

// The built binary on real ports: the playground endpoints next to the collaboration server, sign-in at the
// fake GitLab (its page served here), plain rooms refused (not enabled) with the reason the real
// HocuspocusProvider gets (signed in), the built demo on DEMO_PORT, a clean exit on SIGTERM. Needs ports: it skips where none can be bound (the agent sandbox);
// package playground covers the handlers in-process.
func TestPlaygroundBinary(t *testing.T) {
	port, demoPort := freePort(t), freePort(t)
	dir := t.TempDir()
	binary := filepath.Join(dir, "fake-gitlab")
	out, err := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", binary, ".").CombinedOutput()
	require.NoError(t, err, string(out))
	dist := filepath.Join(dir, "dist")
	require.NoError(t, os.MkdirAll(dist, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(dist, "index.html"), []byte("<title>demo</title>"), 0o644))

	cmd := exec.Command(binary)
	cmd.Dir = testutil.RepoRoot(t)
	cmd.Env = append(os.Environ(), fmt.Sprintf("PORT=%d", port), fmt.Sprintf("DEMO_PORT=%d", demoPort), "ZWF_DEMO_DIST="+dist)
	var logs strings.Builder
	cmd.Stderr = &logs
	require.NoError(t, cmd.Start())
	require.Eventually(t, func() bool {
		c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", demoPort))
		if err == nil {
			c.Close()
		}
		return err == nil
	}, 10*time.Second, 20*time.Millisecond, "the server listens")

	require.Equal(t, `{"project":"demo/report","room":"gitlab:demo/report@main"}`, body(t, "GET", fmt.Sprintf("http://127.0.0.1:%d/playground", port)))
	require.Contains(t, body(t, "POST", fmt.Sprintf("http://127.0.0.1:%d/playground/upstream?room=gitlab%%3Ademo%%2Freport%%40main", port)), "chapters/introduction.typ")
	require.Equal(t, `{"autoCommit":false,"room":"gitlab:demo/report@other"}`, body(t, "POST", fmt.Sprintf("http://127.0.0.1:%d/playground/auto-commit?room=gitlab%%3Ademo%%2Freport%%40other", port)))
	require.Equal(t, `{"plainRooms":false,"guests":false}`, body(t, "GET", fmt.Sprintf("http://127.0.0.1:%d/api/public/info", port)))
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	browser := &http.Client{Jar: jar}
	res, err := browser.Get(fmt.Sprintf("http://127.0.0.1:%d/api/public/auth/login?login_hint=Ann&return=/api/me", port))
	require.NoError(t, err)
	me, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	require.Contains(t, string(me), `"name":"Ann"`, "signed in at the fake GitLab, back at /api/me")
	server, err := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", port))
	require.NoError(t, err)
	var session string
	for _, c := range jar.Cookies(server) {
		if c.Name == "zwf_session" {
			session = c.String()
		}
	}
	refused := testutil.RunNode(t, "hocuspocus-clients.ts", "refused", session, fmt.Sprintf("ws://127.0.0.1:%d/api/collaboration", port))
	require.Contains(t, string(refused), "only GitLab rooms")
	require.Equal(t, "<title>demo</title>", body(t, "GET", fmt.Sprintf("http://127.0.0.1:%d/", demoPort)))

	require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))
	require.NoError(t, cmd.Wait(), logs.String())
	t.Logf("server log:\n%s", logs.String())
}

func freePort(t *testing.T) int {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("cannot bind a port here: %v", err)
	}
	defer probe.Close()
	return probe.Addr().(*net.TCPAddr).Port
}

func body(t *testing.T, method, url string) string {
	req, err := http.NewRequest(method, url, nil)
	require.NoError(t, err)
	res, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	require.Equal(t, 200, res.StatusCode, string(b))
	return strings.TrimSpace(string(b))
}
