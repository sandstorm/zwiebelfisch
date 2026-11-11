// Package local is a folder on this machine as a project: what `zwiebelfisch [path]` edits. Used by:
//   - cmd/zwiebelfisch, which serves Handler next to the app
//
// Every file under the folder is read and written there only (an os.Root: no "..", no symlinks out of it).
// Names starting with "." are neither listed nor written (.git, editors' swap files, Write's temporary files).
// Listed are the files a Typst project uses (ProjectFile) that no .gitignore leaves out, and every file the page
// wrote or asked for (Pull); any other file comes when asked for.
package local

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-git/go-git/v6/plumbing/format/gitignore"
)

// Limits of a folder: Open refuses one listing more files; a bigger file is left out (and cannot be written).
const (
	MaxFiles    = 5000
	MaxFileSize = 50 << 20
)

// projectExtensions are the endings of the files a Typst project uses: sources, data, bibliographies,
// diagrams, images, fonts.
var projectExtensions = map[string]bool{
	".typ": true, ".bib": true, ".csv": true, ".tsv": true, ".json": true, ".yaml": true, ".yml": true,
	".toml": true, ".xml": true, ".cbor": true, ".txt": true, ".md": true, ".mmd": true, ".drawio": true,
	".ic": true, ".svg": true, ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
	".avif": true, ".pdf": true, ".otf": true, ".ttf": true, ".ttc": true, ".woff": true, ".woff2": true,
}

// ProjectFile is whether a file at path is one a Typst project uses, by its ending (case ignored).
func ProjectFile(p string) bool { return projectExtensions[strings.ToLower(path.Ext(p))] }

// Change is one change of a file, as watchers get it: kind "create", "update", "delete" or "rename" (From is
// the old path). Content is set for create and update.
type Change struct {
	Kind    string `json:"kind"`
	Path    string `json:"path"`
	From    string `json:"from,omitempty"`
	Content []byte `json:"content,omitempty"`
	// By is the client whose Write, Delete or Rename it was; "": found on disk by Poll.
	By string `json:"by,omitempty"`
}

// Folder is an opened folder. Paths are a project's: "/chapters/a.typ". Safe for concurrent use.
type Folder struct {
	root *os.Root
	name string
	main string

	mu       sync.Mutex
	files    map[string]file
	kept     map[string]bool // listed whatever their ending or .gitignore says: written or pulled by the page
	watchers map[*watcher]struct{}
	closed   chan struct{}
	close    sync.Once
}

type file struct {
	size    int64
	modTime time.Time
	content []byte
}

type watcher struct{ fn func(Change) }

// Open opens target: a folder, or a .typ file (its folder, with it as the main file; it need not exist yet).
// The main file of a folder is /main.typ if there is one, else its only .typ file at the top, else /main.typ.
func Open(target string) (*Folder, error) {
	target, err := filepath.Abs(target)
	if err != nil {
		return nil, err
	}
	dir, main := target, ""
	if info, err := os.Stat(target); err != nil || !info.IsDir() {
		if filepath.Ext(target) != ".typ" {
			return nil, fmt.Errorf("%s is neither a folder nor a .typ file", target)
		}
		dir, main = filepath.Dir(target), "/"+filepath.Base(target)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	f := &Folder{root: root, name: filepath.Base(dir), files: map[string]file{}, kept: map[string]bool{}, watchers: map[*watcher]struct{}{}, closed: make(chan struct{})}
	if err := f.Poll(); err != nil {
		_ = root.Close()
		return nil, err
	}
	f.main = main
	if f.main == "" {
		f.main = f.defaultMain()
	}
	return f, nil
}

func (f *Folder) defaultMain() string {
	var top []string
	for p := range f.files {
		if path.Dir(p) == "/" && path.Ext(p) == ".typ" {
			top = append(top, p)
		}
	}
	if len(top) == 1 && !slices.Contains(top, "/main.typ") {
		return top[0]
	}
	return "/main.typ"
}

// Close closes the folder: watchers get nothing more, and Closed is closed. Called again: nothing.
func (f *Folder) Close() error {
	err := error(nil)
	f.close.Do(func() {
		close(f.closed)
		err = f.root.Close()
	})
	return err
}

// Closed is closed once the folder is.
func (f *Folder) Closed() <-chan struct{} { return f.closed }

// Name is the folder's name ("thesis").
func (f *Folder) Name() string { return f.name }

// Dir is the folder's absolute path.
func (f *Folder) Dir() string { return f.root.Name() }

// Main is the main file's path.
func (f *Folder) Main() string { return f.main }

// Files are the files as last read or written, by path.
func (f *Folder) Files() map[string][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	files := make(map[string][]byte, len(f.files))
	for p, file := range f.files {
		files[p] = file.content
	}
	return files
}

// Watch calls fn with every change from now on, until stop (fn must not call the Folder).
func (f *Folder) Watch(fn func(Change)) (stop func()) {
	w := &watcher{fn}
	f.mu.Lock()
	f.watchers[w] = struct{}{}
	f.mu.Unlock()
	return func() {
		f.mu.Lock()
		delete(f.watchers, w)
		f.mu.Unlock()
	}
}

func (f *Folder) tell(c Change) {
	for w := range f.watchers {
		w.fn(c)
	}
}

// Write writes content to path (creating its folders), by client by: in place of the file at once (a temporary
// file renamed over it), keeping its permissions.
func (f *Folder) Write(p string, content []byte, by string) error {
	rel, err := relative(p)
	if err != nil {
		return err
	}
	if len(content) > MaxFileSize {
		return fmt.Errorf("%s is bigger than %d MiB", p, MaxFileSize>>20)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	_, exists := f.files[p]
	if !exists && len(f.files) >= MaxFiles {
		return fmt.Errorf("the folder has %d files already", MaxFiles)
	}
	if err := f.root.MkdirAll(filepath.Dir(rel), 0o755); err != nil {
		return err
	}
	mode := fs.FileMode(0o644)
	if info, err := f.root.Lstat(rel); err == nil {
		if !info.Mode().IsRegular() { // a folder, or a symlink: left alone
			return fmt.Errorf("%s is not a file", p)
		}
		mode = info.Mode().Perm()
	}
	tmp := filepath.Join(filepath.Dir(rel), "."+filepath.Base(rel)+".zwiebelfisch~")
	if err := f.root.WriteFile(tmp, content, mode); err != nil {
		return err
	}
	if err := f.root.Rename(tmp, rel); err != nil {
		_ = f.root.Remove(tmp)
		return err
	}
	info, err := f.root.Stat(rel)
	if err != nil {
		return err
	}
	f.files[p] = file{size: info.Size(), modTime: info.ModTime(), content: content}
	f.kept[p] = true
	kind := "update"
	if !exists {
		kind = "create"
	}
	f.tell(Change{Kind: kind, Path: p, Content: content, By: by})
	return nil
}

// Delete deletes the file at path, by client by (gone already: no error).
func (f *Folder) Delete(p, by string) error {
	rel, err := relative(p)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if err := f.root.Remove(rel); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if _, known := f.files[p]; known {
		delete(f.files, p)
		f.tell(Change{Kind: "delete", Path: p, By: by})
	}
	return nil
}

// Rename moves the file at from to to (creating its folders), by client by; there must be none at to.
func (f *Folder) Rename(from, to, by string) error {
	relFrom, err := relative(from)
	if err != nil {
		return err
	}
	relTo, err := relative(to)
	if err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, err := f.root.Lstat(relTo); !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("%s exists already", to)
	}
	if err := f.root.MkdirAll(filepath.Dir(relTo), 0o755); err != nil {
		return err
	}
	if err := f.root.Rename(relFrom, relTo); err != nil {
		return err
	}
	if known, ok := f.files[from]; ok {
		delete(f.files, from)
		f.files[to] = known
	}
	delete(f.kept, from)
	f.kept[to] = true
	f.tell(Change{Kind: "rename", Path: to, From: from, By: by})
	return nil
}

// Pull is the content of the file at path, listed from now on (when it appears, if it does not exist yet:
// fs.ErrNotExist).
func (f *Folder) Pull(p string) ([]byte, error) {
	rel, err := relative(p)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.kept[p] = true
	if known, ok := f.files[p]; ok {
		return known.content, nil
	}
	info, err := f.root.Stat(rel)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > MaxFileSize {
		return nil, fmt.Errorf("%s is no file of at most %d MiB", p, MaxFileSize>>20)
	}
	content, err := f.root.ReadFile(rel)
	if err != nil {
		return nil, err
	}
	f.files[p] = file{size: info.Size(), modTime: info.ModTime(), content: content}
	return content, nil
}

// Poll reads what changed on disk since the last Poll or Write (by modification time and size; a file whose
// content stayed is no change) and tells the watchers. More than MaxFiles files: an error, nothing told.
func (f *Folder) Poll() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	found, err := f.scan()
	if err != nil {
		return err
	}
	var changes []Change
	for p, info := range found {
		known, ok := f.files[p]
		if ok && known.size == info.Size() && known.modTime.Equal(info.ModTime()) {
			continue
		}
		content, err := f.root.ReadFile(filepath.FromSlash(strings.TrimPrefix(p, "/")))
		if err != nil {
			continue // gone again, or unreadable: as if it was not there
		}
		f.files[p] = file{size: info.Size(), modTime: info.ModTime(), content: content}
		switch {
		case !ok:
			changes = append(changes, Change{Kind: "create", Path: p, Content: content})
		case !bytes.Equal(known.content, content):
			changes = append(changes, Change{Kind: "update", Path: p, Content: content})
		}
	}
	for p := range f.files {
		if _, ok := found[p]; !ok {
			delete(f.files, p)
			changes = append(changes, Change{Kind: "delete", Path: p})
		}
	}
	slices.SortFunc(changes, func(a, b Change) int { return strings.Compare(a.Path, b.Path) })
	for _, c := range changes {
		f.tell(c)
	}
	return nil
}

// scan lists the files to list (by path): those of a project's endings outside every .gitignore, and the
// kept ones; none hidden or too big.
func (f *Folder) scan() (map[string]fs.FileInfo, error) {
	found := map[string]fs.FileInfo{}
	var ignored []gitignore.Pattern
	err := fs.WalkDir(f.root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			if name == "." {
				return err
			}
			return nil // unreadable: left out
		}
		if name == "." {
			ignored = append(ignored, f.ignoreFile(nil)...)
			return nil
		}
		segments := strings.Split(name, "/")
		if strings.HasPrefix(entry.Name(), ".") || gitignore.NewMatcher(ignored).Match(segments, entry.IsDir()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			ignored = append(ignored, f.ignoreFile(segments)...)
			return nil
		}
		if !entry.Type().IsRegular() || !(ProjectFile(name) || f.kept["/"+name]) {
			return nil
		}
		if info, err := entry.Info(); err == nil && info.Size() <= MaxFileSize {
			found["/"+name] = info
		}
		if len(found) > MaxFiles {
			return fmt.Errorf("%s has more than %d files a Typst project uses (outside .gitignore): open the folder of one project", f.root.Name(), MaxFiles)
		}
		return nil
	})
	for p := range f.kept { // in ignored folders too
		if _, ok := found[p]; !ok {
			if info, err := f.root.Lstat(filepath.FromSlash(strings.TrimPrefix(p, "/"))); err == nil && info.Mode().IsRegular() && info.Size() <= MaxFileSize {
				found[p] = info
			}
		}
	}
	return found, err
}

// ignoreFile is the patterns of the .gitignore in the folder dir (path segments; nil: the top), if it has one.
func (f *Folder) ignoreFile(dir []string) []gitignore.Pattern {
	content, err := f.root.ReadFile(filepath.Join(append(slices.Clone(dir), ".gitignore")...))
	if err != nil {
		return nil
	}
	var patterns []gitignore.Pattern
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) != "" && !strings.HasPrefix(line, "#") {
			patterns = append(patterns, gitignore.ParsePattern(line, dir))
		}
	}
	return patterns
}

// relative is path ("/chapters/a.typ") relative to the folder, or an error for one that is not a project's
// path or names a hidden file or folder.
func relative(p string) (string, error) {
	rel, ok := strings.CutPrefix(p, "/")
	if !ok || !fs.ValidPath(rel) || rel == "." {
		return "", fmt.Errorf("not a project path: %q", p)
	}
	for _, segment := range strings.Split(rel, "/") {
		if strings.HasPrefix(segment, ".") {
			return "", fmt.Errorf("%s is hidden (starts with \".\")", p)
		}
	}
	return filepath.FromSlash(rel), nil
}
