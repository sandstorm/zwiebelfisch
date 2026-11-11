package local

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"strings"
)

// Handler serves folder to the local editor's page (app/local/local.ts) under /api/local/, to requests that carry
// token (Authorization: Bearer <token>); others get 401:
//
//	GET    /api/local/project         {name, main, files: {path: base64}}
//	GET    /api/local/files/{path...} any other file (Folder.Pull), listed from then on; 404: none (yet)
//	PUT    /api/local/files/{path...} writes the body to the file
//	DELETE /api/local/files/{path...}
//	POST   /api/local/rename          {from, to}
//	GET    /api/local/events          every Change from then on, one JSON object per line
//
// A client names itself in X-Zwiebelfisch-Client; a change it made comes back to it with By set to that name.
func Handler(folder *Folder, token string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/local/project", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]any{"name": folder.Name(), "main": folder.Main(), "files": folder.Files()})
	})
	mux.HandleFunc("GET /api/local/files/{path...}", func(w http.ResponseWriter, r *http.Request) {
		content, err := folder.Pull("/" + r.PathValue("path"))
		switch {
		case errors.Is(err, fs.ErrNotExist):
			http.Error(w, "Not found", http.StatusNotFound)
		case err != nil:
			answer(w, err)
		default:
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(content)
		}
	})
	mux.HandleFunc("PUT /api/local/files/{path...}", func(w http.ResponseWriter, r *http.Request) {
		content, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxFileSize+1))
		if err == nil {
			err = folder.Write("/"+r.PathValue("path"), content, client(r))
		}
		answer(w, err)
	})
	mux.HandleFunc("DELETE /api/local/files/{path...}", func(w http.ResponseWriter, r *http.Request) {
		answer(w, folder.Delete("/"+r.PathValue("path"), client(r)))
	})
	mux.HandleFunc("POST /api/local/rename", func(w http.ResponseWriter, r *http.Request) {
		var body struct{ From, To string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
			http.Error(w, "The body is no {from, to}.", http.StatusBadRequest)
			return
		}
		answer(w, folder.Rename(body.From, body.To, client(r)))
	})
	mux.HandleFunc("GET /api/local/events", func(w http.ResponseWriter, r *http.Request) { events(w, r, folder) })
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		given, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !bearer || subtle.ConstantTimeCompare([]byte(given), []byte(token)) != 1 {
			http.Error(w, "Open the address zwiebelfisch printed in the terminal.", http.StatusUnauthorized)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// events streams the folder's changes to w until the client goes, the folder closes, or the client falls 256
// changes behind (it is dropped: the page asks to reload).
func events(w http.ResponseWriter, r *http.Request, folder *Folder) {
	queue := make(chan Change, 256)
	lagged := make(chan struct{})
	stop := folder.Watch(func(c Change) {
		select {
		case queue <- c:
		case <-lagged:
		default:
			close(lagged)
		}
	})
	defer stop()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	encoder := json.NewEncoder(w)
	for {
		select {
		case <-r.Context().Done():
			return
		case <-folder.Closed():
			return
		case <-lagged:
			return
		case c := <-queue:
			if encoder.Encode(c) != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func client(r *http.Request) string { return r.Header.Get("X-Zwiebelfisch-Client") }

func answer(w http.ResponseWriter, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}
