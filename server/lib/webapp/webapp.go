// Package webapp is the built app (`mise run build:app`: the start page, the editor at /edit, the local
// editor at /local), embedded into the binary. Used by:
//   - zwiebelfisch serve, next to the API
//   - zwiebelfisch [path], the local editor
package webapp

import (
	"embed"
	"errors"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// ErrNotBuilt: the binary was built before the app (`mise run build:app`, then build the binary again).
var ErrNotBuilt = errors.New("this binary has no app built in: run `mise run build:app`, then build it again")

// Files are the app's files (index.html at the top), or ErrNotBuilt.
func Files() (fs.FS, error) {
	files, err := fs.Sub(dist, "dist/app")
	if err != nil {
		return nil, err
	}
	if _, err := fs.Stat(files, "index.html"); err != nil {
		return nil, ErrNotBuilt
	}
	return files, nil
}
