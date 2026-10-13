package collab_test

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/collab"
	"typst-editor/server/lib/testutil"
)

// The real client: @hocuspocus/provider 4.7 (what the widget runs) talks to the server through
// server/testdata/hocuspocus-clients.ts, its WebSockets bridged over the script's stdin/stdout.
func TestRealHocuspocusProvider(t *testing.T) {
	st := memStore(t)
	s := newServer(t, st)
	result := runClients(t, s, "edit", "secret")
	want := map[string]any{"/main.typ": "» Hello 😀 and B 𝄞"}
	require.Equal(t, want, result["texts"])
	require.Equal(t, "permission-denied", result["denied"])
	require.Equal(t, map[string]any{}, result["intruderTexts"], "the refused client got nothing")
	require.Equal(t, false, result["intruderSynced"])

	// a restart: the next server loads what the first stored
	require.NoError(t, s.Close(context.Background()))
	result = runClients(t, newServer(t, st), "read", "secret")
	require.Equal(t, want, result["texts"])
}

type line struct {
	C       int    `json:"c,omitempty"`
	T       string `json:"t"`
	D       string `json:"d,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// runClients runs a scenario of hocuspocus-clients.ts against s and returns its result.
func runClients(t *testing.T, s *collab.Server, scenario, token string) map[string]any {
	cmd := testutil.Node(t, "hocuspocus-clients.ts", scenario, token)
	stdin, err := cmd.StdinPipe()
	require.NoError(t, err)
	stdout, err := cmd.StdoutPipe()
	require.NoError(t, err)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	require.NoError(t, cmd.Start())

	var writeMu sync.Mutex
	write := func(l line) {
		b, _ := json.Marshal(l)
		writeMu.Lock()
		defer writeMu.Unlock()
		_, _ = stdin.Write(append(b, '\n'))
	}
	var wg sync.WaitGroup
	sockets := map[int]*pipe{}
	var result map[string]any
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(nil, 64<<20)
	for scanner.Scan() {
		var l line
		require.NoError(t, json.Unmarshal(scanner.Bytes(), &l), scanner.Text())
		switch l.T {
		case "open":
			p := newPipe()
			sockets[l.C] = p
			wg.Add(2)
			go func() { defer wg.Done(); s.Serve(context.Background(), p) }()
			go func(id int) { // server → client
				defer wg.Done()
				for {
					select {
					case msg := <-p.toClient:
						write(line{C: id, T: "msg", D: base64.StdEncoding.EncodeToString(msg)})
					case <-p.closed:
						write(line{C: id, T: "close", Code: p.code})
						return
					}
				}
			}(l.C)
		case "msg":
			msg, err := base64.StdEncoding.DecodeString(l.D)
			require.NoError(t, err)
			select {
			case sockets[l.C].toServer <- msg:
			case <-sockets[l.C].closed:
			}
		case "close":
			sockets[l.C].Close(1000, "")
		case "result":
			require.NoError(t, json.Unmarshal(scanner.Bytes(), &result))
		case "error":
			t.Errorf("hocuspocus-clients.ts %s: %s", scenario, l.Message)
		}
	}
	_, _ = io.Copy(io.Discard, stdout)
	err = cmd.Wait()
	for _, p := range sockets {
		p.Close(1000, "")
	}
	wg.Wait()
	require.NoError(t, err, stderr.String())
	if stderr.Len() > 0 {
		t.Logf("hocuspocus-clients.ts stderr:\n%s", stderr.String())
	}
	require.NotNil(t, result, "no result")
	return result
}
