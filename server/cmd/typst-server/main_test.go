package main_test

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/testutil"
)

// The built binary on a real port, with real WebSockets from the real HocuspocusProvider: edit with two
// clients, refuse a wrong token, restart (SIGTERM stores the rooms), read the room back. Needs a port: it
// skips where none can be bound (the agent sandbox); TestRealHocuspocusProvider in package collab covers
// the protocol there.
func TestServerBinary(t *testing.T) {
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skipf("cannot bind a port here: %v", err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	require.NoError(t, probe.Close())

	dir := t.TempDir()
	binary := filepath.Join(dir, "typst-server")
	build := exec.Command(filepath.Join(runtime.GOROOT(), "bin", "go"), "build", "-o", binary, ".")
	out, err := build.CombinedOutput()
	require.NoError(t, err, string(out))

	env := append(os.Environ(), fmt.Sprintf("PORT=%d", port), "TYPST_COLLAB_DB="+filepath.Join(dir, "collab.sqlite"),
		"TYPST_COLLAB_TOKEN=secret", "TYPST_LOG_LEVEL=debug")
	url := fmt.Sprintf("ws://127.0.0.1:%d", port)

	stop := start(t, binary, env, port)
	edit := clients(t, "edit", url)
	require.Equal(t, map[string]any{"/main.typ": "» Hello 😀 and B 𝄞"}, edit["texts"])
	require.Equal(t, "permission-denied", edit["denied"])
	require.Equal(t, map[string]any{}, edit["intruderTexts"])
	stop()

	stop = start(t, binary, env, port)
	defer stop()
	require.Equal(t, edit["texts"], clients(t, "read", url)["texts"])
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

func clients(t *testing.T, scenario, url string) map[string]any {
	out := testutil.RunNode(t, "hocuspocus-clients.ts", scenario, "secret", url)
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
