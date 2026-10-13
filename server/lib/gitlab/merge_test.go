package gitlab

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMerge3(t *testing.T) {
	const base = "one\ntwo\nthree\nfour\nfive\n"
	merged := func(base, current, upstream string) any {
		text, conflicts, ok := merge3(base, current, upstream)
		if !ok {
			return conflicts
		}
		return text
	}

	t.Run("takes changes of both sides in different places", func(t *testing.T) {
		require.Equal(t, "ONE\ntwo\nthree\nfour\nFIVE\n", merged(base, "ONE\ntwo\nthree\nfour\nfive\n", "one\ntwo\nthree\nfour\nFIVE\n"))
	})
	t.Run("is not a conflict when both sides made the same change", func(t *testing.T) {
		const same = "one\nTWO\nthree\nfour\nfive\n"
		require.Equal(t, same, merged(base, same, same))
	})
	t.Run("reports the current text range of a conflicting hunk", func(t *testing.T) {
		current := "one\ntwo\nmine\nfour\nfive\n"
		got := merged(base, current, "one\ntwo\ntheirs\nfour\nfive\n")
		require.Equal(t, []conflictRange{{From: 8, To: 13}}, got)
		require.Equal(t, "mine\n", current[8:13])
	})
	t.Run("handles texts without a final newline", func(t *testing.T) {
		require.Equal(t, "A\nb\nC", merged("a\nb\nc", "A\nb\nc", "a\nb\nC"))
	})
	t.Run("treats changes to adjacent lines as a conflict (like diff3)", func(t *testing.T) {
		require.Equal(t, []conflictRange{{From: 0, To: 4}}, merged("a\nb\n", "A\nb\n", "a\nB\n"))
	})
	t.Run("counts conflict ranges in UTF-16 code units", func(t *testing.T) {
		require.Equal(t, []conflictRange{{From: 3, To: 8}}, merged("😀\nb\n", "😀\nmine\n", "😀\ntheirs\n"))
	})
}

func TestTextEdits(t *testing.T) {
	t.Run("turns one text into the other with small edits", func(t *testing.T) {
		from := "Hello world\nsecond line\nthird\n"
		to := "Hello there world\nsecond line\nthird line\n"
		edits := textEdits(from, to)
		require.Equal(t, to, applyEdits(from, edits))
		require.Equal(t, []textEdit{{From: 6, To: 6, Insert: "there "}, {From: 29, To: 29, Insert: " line"}}, edits)
	})
	t.Run("round-trips insertions and deletions of whole lines", func(t *testing.T) {
		const from = "a\nb\nc\n"
		for _, to := range []string{"", "a\nc\n", "x\na\nb\nc\ny", "b\n"} {
			require.Equal(t, to, applyEdits(from, textEdits(from, to)))
		}
	})
	t.Run("counts UTF-16 code units and never splits a surrogate pair", func(t *testing.T) {
		edits := textEdits("a😀b\n", "a😁b\n")
		require.Equal(t, []textEdit{{From: 1, To: 3, Insert: "😁"}}, edits)
		require.Equal(t, "a😁b\n", applyEdits("a😀b\n", edits))
	})
}

func TestMergeFiles(t *testing.T) {
	t.Run("takes upstream changes where the room did not change the file, and merges where both did", func(t *testing.T) {
		base := map[string]string{"/a.typ": "a\n", "/b.typ": "b1\nb2\nb3\n", "/gone.typ": "g"}
		current := map[string]string{"/a.typ": "a\n", "/b.typ": "B1\nb2\nb3\n", "/gone.typ": "g", "/mine.typ": "m"}
		upstream := map[string]string{"/a.typ": "A\n", "/b.typ": "b1\nb2\nB3\n", "/new.typ": "n"}
		changes, conflicts := mergeFiles(base, current, upstream)
		require.Empty(t, conflicts)
		require.Equal(t, map[string]*string{"/a.typ": ptr("A\n"), "/b.typ": ptr("B1\nb2\nB3\n"), "/gone.typ": nil, "/new.typ": ptr("n")}, changes)
	})
	t.Run("reports a file changed on one side and deleted on the other", func(t *testing.T) {
		_, conflicts := mergeFiles(map[string]string{"/a.typ": "a"}, map[string]string{"/a.typ": "changed"}, map[string]string{})
		require.Equal(t, []fileConflict{{Path: "/a.typ", Ranges: []conflictRange{}}}, conflicts)
		_, conflicts = mergeFiles(map[string]string{"/a.typ": "a"}, map[string]string{}, map[string]string{"/a.typ": "changed"})
		require.Equal(t, []fileConflict{{Path: "/a.typ", Ranges: []conflictRange{}}}, conflicts)
	})
	t.Run("merges a file both sides created", func(t *testing.T) {
		changes, conflicts := mergeFiles(map[string]string{}, map[string]string{"/n.typ": "same\n"}, map[string]string{"/n.typ": "same\n"})
		require.Empty(t, changes)
		require.Empty(t, conflicts)
		_, conflicts = mergeFiles(map[string]string{}, map[string]string{"/n.typ": "mine\n"}, map[string]string{"/n.typ": "theirs\n"})
		require.Equal(t, []fileConflict{{Path: "/n.typ", Ranges: []conflictRange{{From: 0, To: 5}}}}, conflicts)
	})
}

func ptr(s string) *string { return &s }
