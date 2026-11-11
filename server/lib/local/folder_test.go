package local_test

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/sandstorm/zwiebelfisch/server/lib/local"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))
}

// folder is a folder with a main file, a chapter, an image, hidden files and a symlink out of it, opened.
func folder(t *testing.T) (*local.Folder, string) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "thesis")
	write(t, filepath.Join(dir, "main.typ"), "= Thesis")
	write(t, filepath.Join(dir, "chapters", "intro.typ"), "Intro")
	write(t, filepath.Join(dir, "logo.png"), "\x89PNG")
	write(t, filepath.Join(dir, ".cache", "config"), "[core]")
	write(t, filepath.Join(dir, ".main.typ.swp"), "swap")
	write(t, filepath.Join(parent, "secret.txt"), "not listed")
	require.NoError(t, os.Symlink(filepath.Join(parent, "secret.txt"), filepath.Join(dir, "link.txt")))
	f, err := local.Open(dir)
	require.NoError(t, err)
	t.Cleanup(func() { _ = f.Close() })
	return f, dir
}

func watch(f *local.Folder) *[]local.Change {
	var changes []local.Change
	f.Watch(func(c local.Change) { changes = append(changes, c) })
	return &changes
}

func TestOpenListsTheProjectFiles(t *testing.T) {
	f, _ := folder(t)
	require.Equal(t, "thesis", f.Name())
	require.Equal(t, "/main.typ", f.Main())
	require.Equal(t, map[string][]byte{
		"/main.typ": []byte("= Thesis"), "/chapters/intro.typ": []byte("Intro"), "/logo.png": []byte("\x89PNG"),
	}, f.Files())
}

func TestOpenPicksTheMainFile(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "letter.typ"), "Dear")
	write(t, filepath.Join(dir, "parts", "a.typ"), "A")
	f, err := local.Open(dir)
	require.NoError(t, err)
	require.Equal(t, "/letter.typ", f.Main(), "the only .typ file at the top")

	write(t, filepath.Join(dir, "other.typ"), "Other")
	f, err = local.Open(dir)
	require.NoError(t, err)
	require.Equal(t, "/main.typ", f.Main(), "two at the top: main.typ, which the first edit creates")

	f, err = local.Open(filepath.Join(dir, "other.typ"))
	require.NoError(t, err)
	require.Equal(t, "/other.typ", f.Main(), "a file given")
	require.Equal(t, filepath.Base(dir), f.Name())

	f, err = local.Open(filepath.Join(dir, "new.typ"))
	require.NoError(t, err)
	require.Equal(t, "/new.typ", f.Main(), "a .typ file that does not exist yet")

	_, err = local.Open(filepath.Join(dir, "missing"))
	require.ErrorContains(t, err, "neither a folder nor a .typ file")
}

func TestOpenRefusesTooManyFiles(t *testing.T) {
	dir := t.TempDir()
	for i := range local.MaxFiles + 1 {
		write(t, filepath.Join(dir, "data", fmt.Sprintf("%d.csv", i)), "")
	}
	_, err := local.Open(dir)
	require.ErrorContains(t, err, "more than 2000 files")
}

func TestWriteDeleteRename(t *testing.T) {
	f, dir := folder(t)
	changes := watch(f)
	info, err := os.Stat(filepath.Join(dir, "main.typ"))
	require.NoError(t, err)
	require.NoError(t, os.Chmod(filepath.Join(dir, "main.typ"), 0o600))

	require.NoError(t, f.Write("/main.typ", []byte("= New"), "tab"))
	require.NoError(t, f.Write("/appendix/a.typ", []byte("A"), "tab"))
	require.NoError(t, f.Rename("/chapters/intro.typ", "/chapters/start.typ", "tab"))
	require.NoError(t, f.Delete("/logo.png", "tab"))

	main, err := os.ReadFile(filepath.Join(dir, "main.typ"))
	require.NoError(t, err)
	require.Equal(t, "= New", string(main))
	after, err := os.Stat(filepath.Join(dir, "main.typ"))
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0o600), after.Mode().Perm(), "permissions kept (were %v)", info.Mode().Perm())
	appendix, err := os.ReadFile(filepath.Join(dir, "appendix", "a.typ"))
	require.NoError(t, err)
	require.Equal(t, "A", string(appendix))
	require.NoFileExists(t, filepath.Join(dir, "chapters", "intro.typ"))
	require.FileExists(t, filepath.Join(dir, "chapters", "start.typ"))
	require.NoFileExists(t, filepath.Join(dir, "logo.png"))
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	for _, e := range entries {
		require.NotContains(t, e.Name(), "zwiebelfisch~", "no temporary file left")
	}

	require.Equal(t, []local.Change{
		{Kind: "update", Path: "/main.typ", Content: []byte("= New"), By: "tab"},
		{Kind: "create", Path: "/appendix/a.typ", Content: []byte("A"), By: "tab"},
		{Kind: "rename", Path: "/chapters/start.typ", From: "/chapters/intro.typ", By: "tab"},
		{Kind: "delete", Path: "/logo.png", By: "tab"},
	}, *changes)
	require.NoError(t, f.Poll())
	require.Len(t, *changes, 4, "its own writes are no changes on disk")
}

func TestPollFindsChangesOnDisk(t *testing.T) {
	f, dir := folder(t)
	changes := watch(f)
	write(t, filepath.Join(dir, "main.typ"), "= Changed")
	write(t, filepath.Join(dir, "chapters", "two.typ"), "Two")
	require.NoError(t, os.Remove(filepath.Join(dir, "logo.png")))
	write(t, filepath.Join(dir, ".hidden.typ"), "not listed")
	later := time.Now().Add(time.Minute)
	require.NoError(t, os.Chtimes(filepath.Join(dir, "chapters", "intro.typ"), later, later)) // touched, same content
	require.NoError(t, f.Poll())
	require.Equal(t, []local.Change{
		{Kind: "create", Path: "/chapters/two.typ", Content: []byte("Two")},
		{Kind: "delete", Path: "/logo.png"},
		{Kind: "update", Path: "/main.typ", Content: []byte("= Changed")},
	}, *changes)
	require.NoError(t, f.Poll())
	require.Len(t, *changes, 3)
}

func TestRefusedPaths(t *testing.T) {
	f, dir := folder(t)
	for _, path := range []string{"main.typ", "/", "/../escape.typ", "/a/../../escape.typ", "/.cache/config", "/a/.env", "//x.typ", "/link.txt/x"} {
		require.Error(t, f.Write(path, []byte("x"), ""), path)
	}
	require.Error(t, f.Delete("/../secret.txt", ""))
	require.Error(t, f.Rename("/main.typ", "/chapters/intro.typ", ""), "exists already")
	require.Error(t, f.Rename("/main.typ", "/../out.typ", ""))
	config, err := os.ReadFile(filepath.Join(dir, ".cache", "config"))
	require.NoError(t, err)
	require.Equal(t, "[core]", string(config))
	require.NoFileExists(t, filepath.Join(filepath.Dir(dir), "escape.typ"))
}

func TestWriteThroughASymlinkOutIsRefused(t *testing.T) {
	f, dir := folder(t)
	require.Error(t, f.Write("/link.txt", []byte("overwritten"), ""))
	secret, err := os.ReadFile(filepath.Join(filepath.Dir(dir), "secret.txt"))
	require.NoError(t, err)
	require.Equal(t, "not listed", string(secret))
}
