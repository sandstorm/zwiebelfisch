package app

import (
	"net/http"
	"os"
	"path"
	"strings"
)

// StaticFiles serves a Vite build (dist/app, dist/demo) as it is, without Vite. Used by:
//   - zwiebelfisch, for the app next to the API (WithStaticFiles)
//   - fake-gitlab, for the demo on a port of its own
//
// GET and HEAD (ranges too); / is index.html, a path without an extension its .html page (/edit is
// edit.html); anything else (folders, paths outside dir, symlinks out of it) is 404. Vite's content-hashed
// files under assets/ are cached for good, everything else is revalidated.
func StaticFiles(dir string) http.Handler { return staticFiles(dir) }

// WithStaticFiles is api on /api/ and the files under dir (StaticFiles) everywhere else, on one origin.
func WithStaticFiles(api http.Handler, dir string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", StaticFiles(dir))
	return mux
}

type staticFiles string

func (dir staticFiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	} else if path.Ext(name) == "" {
		name += ".html"
	}
	// os.OpenInRoot refuses whatever leaves dir (.., absolute paths, symlinks out)
	f, err := os.OpenInRoot(string(dir), name)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	contentType, ok := staticTypes[strings.ToLower(path.Ext(name))]
	if !ok {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// staticTypes of what a Vite build contains (WebAssembly must be application/wasm to stream).
var staticTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json",
	".wasm":  "application/wasm",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".otf":   "font/otf",
	".ttf":   "font/ttf",
	".woff2": "font/woff2",
}
