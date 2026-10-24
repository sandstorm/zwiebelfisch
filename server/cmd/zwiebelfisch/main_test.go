package main_test

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
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

	"github.com/sandstorm/zwiebelfisch/server/lib/fakegitlab"
	"github.com/sandstorm/zwiebelfisch/server/lib/testutil"
)

// The built binary on a real port, with real WebSockets from the real HocuspocusProvider: sign in (at the
// fake GitLab's OpenID Connect provider, on a port of its own), edit with two clients in a plain room,
// refuse a client without a session (401, before the WebSocket's upgrade), restart (SIGTERM stores the rooms; the sessions are gone: sign in
// again), read the room back. Needs ports: it skips where none can be bound (the agent sandbox);
// TestRealHocuspocusProvider in package collab and the tests of package app and auth cover it there.
func TestServerBinary(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("cannot bind a port here: %v", err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	require.NoError(t, probe.Close())

	dir := t.TempDir()
	binary := build(t, dir)

	issuer := httptest.NewUnstartedServer(nil)
	issuerURL := "http://" + issuer.Listener.Addr().String()
	issuer.Config.Handler = fakegitlab.NewIdentityProvider(issuerURL, issuerURL+"/oauth/authorize")
	issuer.Start()
	defer issuer.Close()
	signIn := []string{"ZWF_AUTH_ISSUER=" + issuerURL, "ZWF_AUTH_CLIENT_ID=" + fakegitlab.ClientID, "ZWF_AUTH_CLIENT_SECRET=" + fakegitlab.ClientSecret}
	env := append(append(os.Environ(), "ZWF_ALLOWED_ORIGINS=http://127.0.0.1:5199", fmt.Sprintf("PORT=%d", port), "ZWF_COLLAB_DB="+filepath.Join(dir, "collab.sqlite"),
		"ZWF_PLAIN_ROOMS=1", "ZWF_LOG_LEVEL=debug"), signIn...)
	server := fmt.Sprintf("http://127.0.0.1:%d", port)
	ws := fmt.Sprintf("ws://127.0.0.1:%d/api/collaboration", port)

	stop := start(t, binary, env, port)
	edit := clients(t, "edit", ws, session(t, server, "Ann"))
	require.Equal(t, map[string]any{"/main.typ": "» Hello 😀 and B 𝄞"}, edit["texts"])
	require.Equal(t, "closed", edit["denied"], "the WebSocket was refused")
	require.Equal(t, map[string]any{}, edit["intruderTexts"])
	res, err := http.Get(server + "/api/collaboration")
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	require.Equal(t, http.StatusUnauthorized, res.StatusCode)
	stop()

	stop = start(t, binary, env, port)
	require.Equal(t, edit["texts"], clients(t, "read", ws, session(t, server, "Ann"))["texts"])
	stop()
}

// Without allowed origins (or with an invalid one), sign-in or rooms, the binary exits before it listens.
func TestServerBinaryRefusesToStart(t *testing.T) {
	binary := build(t, t.TempDir())
	origins := "ZWF_ALLOWED_ORIGINS=https://editor.example.org"
	signIn := []string{"ZWF_AUTH_ISSUER=https://id.example", "ZWF_AUTH_CLIENT_ID=app", "ZWF_AUTH_CLIENT_SECRET=secret"}
	for _, bare := range []struct {
		env     []string
		refusal string
	}{
		{append([]string{"ZWF_PLAIN_ROOMS=1"}, signIn...), "ZWF_ALLOWED_ORIGINS is required"},
		{append([]string{"ZWF_PLAIN_ROOMS=1", "ZWF_ALLOWED_ORIGINS="}, signIn...), "ZWF_ALLOWED_ORIGINS is required"},
		{append([]string{"ZWF_PLAIN_ROOMS=1", "ZWF_ALLOWED_ORIGINS=*"}, signIn...), "ZWF_ALLOWED_ORIGINS: "},
		{append([]string{"ZWF_PLAIN_ROOMS=1", "ZWF_ALLOWED_ORIGINS=https://editor.example.org/app"}, signIn...), "ZWF_ALLOWED_ORIGINS: "},
		{[]string{"ZWF_PLAIN_ROOMS=1", origins}, "sign-in is not configured"},
		{append([]string{origins}, signIn...), "no rooms to serve"},
	} {
		cmd := exec.Command(binary)
		cmd.Env = append([]string{"PORT=1", "ZWF_COLLAB_DB=:memory:"}, bare.env...)
		out, err := cmd.CombinedOutput()
		require.Error(t, err, bare.env)
		require.Contains(t, string(out), bare.refusal, bare.env)
	}
}

// build compiles the command into dir.
func build(t *testing.T, dir string) string {
	binary := filepath.Join(dir, "zwiebelfisch")
	out, err := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", binary, ".").CombinedOutput()
	require.NoError(t, err, string(out))
	return binary
}

// session signs name in at server (through the issuer, following the redirects) and returns the Cookie
// header that carries the session.
func session(t *testing.T, server, name string) string {
	jar, err := cookiejar.New(nil)
	require.NoError(t, err)
	client := &http.Client{Jar: jar}
	res, err := client.Get(server + "/api/public/auth/login?" + url.Values{"login_hint": {name}, "return": {"/api/me"}}.Encode())
	require.NoError(t, err)
	require.NoError(t, res.Body.Close())
	require.Equal(t, http.StatusOK, res.StatusCode)
	u, err := url.Parse(server)
	require.NoError(t, err)
	for _, c := range jar.Cookies(u) {
		if c.Name == "zwf_session" {
			return c.String()
		}
	}
	t.Fatal("no session cookie")
	return ""
}

// start runs the server and waits until it accepts connections; stop sends SIGTERM and waits for the exit.
func start(t *testing.T, binary string, env []string, port int) (stop func()) {
	cmd := exec.Command(binary)
	cmd.Env = env
	var logs strings.Builder
	cmd.Stderr = &logs
	require.NoError(t, cmd.Start())
	require.Eventually(t, func() bool {
		c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			c.Close()
		}
		return err == nil
	}, 10*time.Second, 20*time.Millisecond, "the server listens")
	return func() {
		require.NoError(t, cmd.Process.Signal(syscall.SIGTERM))
		require.NoError(t, cmd.Wait(), logs.String())
		t.Logf("server log:\n%s", logs.String())
	}
}

func clients(t *testing.T, scenario, url, cookie string) map[string]any {
	out := testutil.RunNode(t, "hocuspocus-clients.ts", scenario, cookie, url)
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		var l map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &l), line)
		if l["t"] == "result" {
			return l
		}
	}
	t.Fatalf("no result from hocuspocus-clients.ts %s:\n%s", scenario, out)
	return nil
}
