// Package testutil helps Go tests check the server against the real JavaScript side (yjs, the Hocuspocus
// provider): it finds the repository and runs Node scripts from server/testdata there.
//
// The browser is the other half of every protocol the server speaks, so the tests that matter most run
// its libraries. They need Node and the installed node_modules (mise run install); without them they skip,
// so `go test` still works in a Go-only environment (e.g. the Docker build stage).
package testutil

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// RepoRoot is the directory with go.mod (tests run in their package's directory).
func RepoRoot(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("testutil: no go.mod above the test's directory")
		}
		dir = parent
	}
}

// Node returns a command running the Node script server/testdata/<script> with args in the repository
// root, or skips the test when Node or node_modules are missing.
func Node(t testing.TB, script string, args ...string) *exec.Cmd {
	t.Helper()
	root := RepoRoot(t)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("testutil: node not on PATH (run through `mise exec`)")
	}
	if _, err := os.Stat(filepath.Join(root, "node_modules", "yjs")); err != nil {
		t.Skip("testutil: node_modules missing (mise run install)")
	}
	cmd := exec.Command(node, append([]string{filepath.Join(root, "server", "testdata", script)}, args...)...)
	cmd.Dir = root
	return cmd
}

// RunNode runs a script (see Node) to the end and returns its stdout; stderr goes to the test log.
func RunNode(t testing.TB, script string, args ...string) []byte {
	t.Helper()
	cmd := Node(t, script, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("node %s: %v\n%s", script, err, stderr.String())
	}
	if stderr.Len() > 0 {
		t.Logf("node %s stderr:\n%s", script, stderr.String())
	}
	return stdout.Bytes()
}
