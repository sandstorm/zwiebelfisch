package gitlab

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCommitActions(t *testing.T) {
	meta := func(texts map[string]string, assets map[string]string) *base {
		return &base{Sha: "b0", Texts: texts, Assets: assets}
	}
	text := func(kind ActionKind, path, content string) Action {
		return Action{Kind: kind, Path: path, Content: []byte(content), Text: true}
	}

	t.Run("updates changed files", func(t *testing.T) {
		files := roomFiles{texts: map[string]string{"/a.typ": "A", "/b.typ": "b"}}
		require.Equal(t, []Action{text(ActionUpdate, "/a.typ", "A")}, commitActions(meta(map[string]string{"/a.typ": "a", "/b.typ": "b"}, nil), files))
	})

	t.Run("pairs a deleted and a created file of similar content as a move", func(t *testing.T) {
		edited := "= One\nline 1\nline 2\nline 3 edited\n"
		actions := commitActions(meta(map[string]string{"/ch1.typ": "= One\nline 1\nline 2\nline 3\n"}, nil), roomFiles{texts: map[string]string{"/chapter.typ": edited}})
		require.Equal(t, []Action{{Kind: ActionMove, Path: "/chapter.typ", PreviousPath: "/ch1.typ", Content: []byte(edited), Text: true}}, actions)
		require.Equal(t, []changedFile{{"/ch1.typ", "deleted"}, {"/chapter.typ", "added"}}, changedFiles(actions))
	})

	t.Run("keeps unrelated deletions and creations apart", func(t *testing.T) {
		actions := commitActions(meta(map[string]string{"/old.typ": "one\ntwo\nthree"}, nil), roomFiles{texts: map[string]string{"/new.typ": "something\nelse"}})
		var kinds []ActionKind
		for _, a := range actions {
			kinds = append(kinds, a.Kind)
		}
		require.Equal(t, []ActionKind{ActionCreate, ActionDelete}, kinds)
	})

	t.Run("uploads new bytes, moves renamed repository files, deletes removed ones, skips unchanged ones", func(t *testing.T) {
		same := []byte{1}
		assets := map[string]string{"/same.png": blobSha(same), "/a.png": "sha-a", "/gone.png": "sha-gone"}
		files := roomFiles{texts: map[string]string{}, assets: map[string]any{"/same.png": same, "/b.png": "sha-a", "/new.png": []byte{2}}}
		require.Equal(t, []Action{
			{Kind: ActionMove, Path: "/b.png", PreviousPath: "/a.png"},
			{Kind: ActionCreate, Path: "/new.png", Content: []byte{2}},
			{Kind: ActionDelete, Path: "/gone.png"},
		}, commitActions(meta(map[string]string{}, assets), files))
	})
}

func TestGitLabActions(t *testing.T) {
	require.Equal(t, map[string]string{"action": "create", "file_path": "a.typ", "content": "", "encoding": "text"},
		gitlabAction(Action{Kind: ActionCreate, Path: "/a.typ", Content: []byte(""), Text: true}), "an empty text is content too")
	require.Equal(t, map[string]string{"action": "update", "file_path": "img/x.png", "content": "AQI=", "encoding": "base64"},
		gitlabAction(Action{Kind: ActionUpdate, Path: "/img/x.png", Content: []byte{1, 2}}))
	require.Equal(t, map[string]string{"action": "move", "file_path": "b.png", "previous_path": "a.png"},
		gitlabAction(Action{Kind: ActionMove, Path: "/b.png", PreviousPath: "/a.png"}))
	require.Equal(t, map[string]string{"action": "delete", "file_path": "a.typ"}, gitlabAction(Action{Kind: ActionDelete, Path: "/a.typ"}))
}

func TestBlobSha(t *testing.T) {
	require.Equal(t, "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", blobSha(nil), "git's empty blob")
	require.Equal(t, "ce013625030ba8dba906f756967f9e9ca394464a", blobSha([]byte("hello\n")))
}

func TestBlobCacheDropsTheLeastRecentlyUsed(t *testing.T) {
	c := newBlobCache(4)
	loads := 0
	load := func(b []byte) func() ([]byte, error) { return func() ([]byte, error) { loads++; return b, nil } }
	_, _ = c.get("a", load([]byte{1, 1}))
	_, _ = c.get("b", load([]byte{2, 2}))
	_, _ = c.get("a", load(nil)) // a is now the most recent
	_, _ = c.get("c", load([]byte{3}))
	require.Equal(t, 3, loads)
	got, _ := c.get("a", load(nil))
	require.Equal(t, []byte{1, 1}, got, "kept")
	_, _ = c.get("b", load([]byte{2, 2}))
	require.Equal(t, 4, loads, "b went first")
}
