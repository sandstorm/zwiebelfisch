package playground

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

// ReadProjectFiles reads a project folder on disk (the fake repository's content) into files keyed by
// absolute project path (<dir>/chapters/a.typ → /chapters/a.typ), as the widget takes them.
func ReadProjectFiles(dir string) (map[string][]byte, error) {
	files := map[string][]byte{}
	root := os.DirFS(dir)
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || !entry.Type().IsRegular() {
			return err
		}
		files["/"+name], err = fs.ReadFile(root, name)
		return err
	})
	return files, err
}

// StaticFiles serves the files under dir as they are: GET and HEAD (ranges too), / is index.html, anything
// else (folders, paths outside dir) is 404.
//
// The Docker image runs the playground without Vite: the playground server serves the built demo (dist/demo,
// `mise run build:demo`) itself, on the port Vite would use. Vite's content-hashed files under assets/ are
// cached for good, everything else is revalidated. Without a checkout the Documentation example saves
// nothing (the playground bar says so).
func StaticFiles(dir string) http.Handler { return staticFiles(dir) }

type staticFiles string

func (dir staticFiles) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		text(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	// os.OpenInRoot refuses whatever leaves dir (.., absolute paths, symlinks out)
	f, err := os.OpenInRoot(string(dir), name)
	if err != nil {
		text(w, http.StatusNotFound, "Not found")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		text(w, http.StatusNotFound, "Not found")
		return
	}
	contentType, ok := types[strings.ToLower(path.Ext(name))]
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

// types of what a Vite build of the demo contains (WebAssembly must be application/wasm to stream).
var types = map[string]string{
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
