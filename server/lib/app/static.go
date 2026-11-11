package app

import (
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// StaticFiles serves a Vite build (the embedded app, dist/demo) as it is, without Vite. Used by:
//   - zwiebelfisch, for the app next to the API (WithStaticFiles)
//   - fake-gitlab, for the demo on a port of its own
//
// GET and HEAD (ranges too); / is index.html, a path without an extension its .html page (/edit is
// edit.html); anything else (folders, paths files refuses) is 404. Vite's content-hashed files under
// assets/ are cached for good, everything else is revalidated.
func StaticFiles(files fs.FS) http.Handler { return staticFiles{files} }

// WithStaticFiles is api on /api/ and files (StaticFiles) everywhere else, on one origin.
func WithStaticFiles(api http.Handler, files fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/", StaticFiles(files))
	return mux
}

type staticFiles struct{ files fs.FS }

func (s staticFiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	f, err := s.files.Open(name)
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
	content, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
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
