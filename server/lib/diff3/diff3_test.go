package diff3_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"

	"typst-editor/server/lib/diff3"
)

// The fixtures are node-diff3 3.2.1's own results for random line sequences: the port must merge
// exactly as it does.
func TestNodeDiff3Fixtures(t *testing.T) {
	raw, err := os.ReadFile("testdata/node-diff3.json")
	require.NoError(t, err)
	type conflict struct {
		A      []string `json:"a"`
		AIndex int      `json:"aIndex"`
		O      []string `json:"o"`
		OIndex int      `json:"oIndex"`
		B      []string `json:"b"`
		BIndex int      `json:"bIndex"`
	}
	var cases []struct {
		A, O, B []string
		Merge   []struct {
			OK       []string  `json:"ok"`
			Conflict *conflict `json:"conflict"`
		}
		Patch [][4]int
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	conflicts := 0
	for i, c := range cases {
		var want []diff3.Region
		for _, r := range c.Merge {
			region := diff3.Region{OK: r.OK}
			if k := r.Conflict; k != nil {
				conflicts++
				region.Conflict = &diff3.Conflict{A: k.A, AIndex: k.AIndex, O: k.O, OIndex: k.OIndex, B: k.B, BIndex: k.BIndex}
			}
			want = append(want, region)
		}
		require.Equal(t, normalize(want), normalize(diff3.Merge(c.A, c.O, c.B)), "case %d: %q %q %q", i, c.A, c.O, c.B)
		var hunks []diff3.Hunk
		for _, p := range c.Patch {
			hunks = append(hunks, diff3.Hunk{A: p[0], ALen: p[1], B: p[2], BLen: p[3]})
		}
		require.Equal(t, hunks, diff3.Diff(c.O, c.A), "case %d", i)
	}
	require.Greater(t, conflicts, 20, "the fixtures exercise conflicts")
}

// normalize makes empty slices nil (JSON has [] where Go has nil).
func normalize(regions []diff3.Region) []diff3.Region {
	nilIfEmpty := func(s []string) []string {
		if len(s) == 0 {
			return nil
		}
		return s
	}
	for i, r := range regions {
		regions[i].OK = nilIfEmpty(r.OK)
		if c := r.Conflict; c != nil {
			regions[i].Conflict = &diff3.Conflict{A: nilIfEmpty(c.A), AIndex: c.AIndex, O: nilIfEmpty(c.O), OIndex: c.OIndex, B: nilIfEmpty(c.B), BIndex: c.BIndex}
		}
	}
	return regions
}

func TestMergeTakesBothSidesAndReportsConflicts(t *testing.T) {
	o := []string{"one", "two", "three"}
	require.Equal(t, []diff3.Region{{OK: []string{"ONE", "two", "THREE"}}},
		diff3.Merge([]string{"ONE", "two", "three"}, o, []string{"one", "two", "THREE"}))
	require.Equal(t, []diff3.Region{
		{OK: []string{"one"}},
		{Conflict: &diff3.Conflict{A: []string{"mine"}, AIndex: 1, O: []string{"two"}, OIndex: 1, B: []string{"theirs"}, BIndex: 1}},
		{OK: []string{"three"}},
	}, diff3.Merge([]string{"one", "mine", "three"}, o, []string{"one", "theirs", "three"}))
}
