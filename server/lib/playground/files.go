package playground

import (
	"io/fs"
	"os"
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
