package app_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/app"
)

// StaticFiles on a folder like dist/demo, in-process (no port).

func demo(t *testing.T) http.Handler {
	parent := t.TempDir()
	root := filepath.Join(parent, "demo")
	require.NoError(t, os.MkdirAll(filepath.Join(root, "assets"), 0o755))
	write := func(path, content string) {
		require.NoError(t, os.WriteFile(filepath.Join(parent, path), []byte(content), 0o644))
	}
	write("demo/index.html", "<!doctype html><title>demo</title>")
	write("demo/edit.html", "<!doctype html><title>edit</title>")
	write("demo/assets/engine-abc123.wasm", "\x00asm")
	write("demo/assets/a b.js", "export {};")
	write("secret.txt", "not served")
	require.NoError(t, os.Symlink(filepath.Join(parent, "secret.txt"), filepath.Join(root, "link.txt")))
	return app.StaticFiles(root)
}

func get(h http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestStaticIndex(t *testing.T) {
	rec := get(demo(t), "GET", "/?room=playground-hello&user=Ann")
	require.Equal(t, 200, rec.Code)
	require.Equal(t, "text/html; charset=utf-8", rec.Header().Get("Content-Type"))
	require.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	require.Equal(t, "<!doctype html><title>demo</title>", rec.Body.String())
}

func TestStaticPageWithoutExtension(t *testing.T) {
	rec := get(demo(t), "GET", "/edit?room=gitlab:group/p@main")
	require.Equal(t, 200, rec.Code)
	require.Equal(t, "<!doctype html><title>edit</title>", rec.Body.String())
}

func TestWithStaticFiles(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("api " + r.URL.Path)) })
	h := app.WithStaticFiles(api, filepath.Join(t.TempDir(), "missing"))
	require.Equal(t, "api /api/me", get(h, "GET", "/api/me").Body.String())
	require.Equal(t, 404, get(h, "GET", "/").Code)
}

func TestStaticAssetsCachedForGood(t *testing.T) {
	h := demo(t)
	wasm := get(h, "GET", "/assets/engine-abc123.wasm")
	require.Equal(t, "application/wasm", wasm.Header().Get("Content-Type"))
	require.Equal(t, "4", wasm.Header().Get("Content-Length"))
	require.Equal(t, "public, max-age=31536000, immutable", wasm.Header().Get("Cache-Control"))
	require.Equal(t, []byte{0, 'a', 's', 'm'}, wasm.Body.Bytes())

	script := get(h, "GET", "/assets/a%20b.js")
	require.Equal(t, "text/javascript; charset=utf-8", script.Header().Get("Content-Type"))
	require.Equal(t, "export {};", script.Body.String())
}

func TestStaticHead(t *testing.T) {
	rec := get(demo(t), "HEAD", "/index.html")
	require.Equal(t, 200, rec.Code)
	require.Equal(t, "34", rec.Header().Get("Content-Length"))
	require.Zero(t, rec.Body.Len())
}

func TestStaticNotFound(t *testing.T) {
	h := demo(t)
	// (a malformed escape like /%E0%A4%A never gets here: Go's server answers 400 itself)
	for _, target := range []string{"/missing.js", "/assets", "/../secret.txt", "/%2e%2e/secret.txt",
		"/assets/%2e%2e/%2e%2e/secret.txt", "//etc/hosts", "/link.txt"} {
		require.Equal(t, 404, get(h, "GET", target).Code, target)
	}
}

func TestStaticMethodNotAllowed(t *testing.T) {
	require.Equal(t, 405, get(demo(t), "POST", "/index.html").Code)
}
