// Package diff3 compares sequences (lines of text): the changes from one to another, and the three-way
// merge of two sequences derived from a common one, with conflicts.
//
// A port of node-diff3 3.x (Bryan Housel; diffPatch, diff3Merge), which the TypeScript server used: rooms
// merged by it must merge the same way here. The LCS is Hunt and McIlroy's (1976); the merge regions follow
// Khanna, Kunal and Pierce, "A Formal Investigation of Diff3" (2007).
package diff3

import (
	"slices"
	"sort"
)

// Hunk is one difference between two sequences a and b: a[A:A+ALen] is replaced by b[B:B+BLen].
type Hunk struct {
	A, ALen, B, BLen int
}

// Diff returns the hunks that turn a into b, in ascending order.
func Diff(a, b []string) []Hunk {
	var hunks []Hunk
	tail1, tail2 := len(a), len(b)
	for c := lcs(a, b); c != nil; c = c.chain {
		len1 := tail1 - c.i - 1
		len2 := tail2 - c.j - 1
		tail1, tail2 = c.i, c.j
		if len1 != 0 || len2 != 0 {
			hunks = append(hunks, Hunk{A: c.i + 1, ALen: len1, B: c.j + 1, BLen: len2})
		}
	}
	slices.Reverse(hunks)
	return hunks
}

// Region is a piece of a three-way merge: either merged (OK) or a Conflict.
type Region struct {
	OK       []string
	Conflict *Conflict
}

// Conflict is a region both sides changed differently: A and B are the sides' versions of O, AIndex and
// BIndex where they start in a and b.
type Conflict struct {
	A, O, B                []string
	AIndex, OIndex, BIndex int
}

// Merge merges the changes from o to a and from o to b. Where both changed the same (or adjacent) items
// differently, the result has a Conflict; where they made the same change, it is merged (no false
// conflicts).
func Merge(a, o, b []string) []Region {
	var regions []Region
	var ok []string
	flush := func() {
		if len(ok) > 0 {
			regions = append(regions, Region{OK: ok})
		}
		ok = nil
	}
	for _, r := range mergeRegions(a, o, b) {
		switch {
		case r.stable:
			ok = append(ok, r.content...)
		case slices.Equal(r.aContent, r.bContent):
			ok = append(ok, r.aContent...)
		default:
			flush()
			regions = append(regions, Region{Conflict: &Conflict{
				A: r.aContent, AIndex: r.aStart, O: r.oContent, OIndex: r.oStart, B: r.bContent, BIndex: r.bStart,
			}})
		}
	}
	flush()
	return regions
}

// candidate is a link of the LCS chain: a[i] == b[j].
type candidate struct {
	i, j  int
	chain *candidate
}

// lcs returns the longest common subsequence of a and b as a chain from its last item (-1, -1 ends it).
func lcs(a, b []string) *candidate {
	classes := map[string][]int{}
	for j, item := range b {
		classes[item] = append(classes[item], j)
	}
	candidates := []*candidate{{i: -1, j: -1}}
	for i, item := range a {
		r := 0
		c := candidates[0]
		for _, j := range classes[item] {
			s := r
			for ; s < len(candidates); s++ {
				if candidates[s].j < j && (s == len(candidates)-1 || candidates[s+1].j > j) {
					break
				}
			}
			if s < len(candidates) {
				next := &candidate{i: i, j: j, chain: candidates[s]}
				if r == len(candidates) {
					candidates = append(candidates, c)
				} else {
					candidates[r] = c
				}
				r = s + 1
				c = next
				if r == len(candidates) {
					break
				}
			}
		}
		if r == len(candidates) {
			candidates = append(candidates, c)
		} else {
			candidates[r] = c
		}
	}
	return candidates[len(candidates)-1]
}

type region struct {
	stable                       bool
	content                      []string // stable
	aStart, oStart, bStart       int
	aContent, oContent, bContent []string
}

type hunk struct {
	b                            bool // from o→b (else o→a)
	oStart, oLen, abStart, abLen int
}

func mergeRegions(a, o, b []string) []region {
	var hunks []hunk
	for _, h := range Diff(o, a) {
		hunks = append(hunks, hunk{false, h.A, h.ALen, h.B, h.BLen})
	}
	for _, h := range Diff(o, b) {
		hunks = append(hunks, hunk{true, h.A, h.ALen, h.B, h.BLen})
	}
	sort.SliceStable(hunks, func(i, j int) bool { return hunks[i].oStart < hunks[j].oStart })

	var results []region
	offset := 0
	advanceTo := func(end int) {
		if end > offset {
			results = append(results, region{stable: true, content: o[offset:end]})
			offset = end
		}
	}
	for len(hunks) > 0 {
		h := hunks[0]
		hunks = hunks[1:]
		start, end := h.oStart, h.oStart+h.oLen
		group := []hunk{h}
		advanceTo(start)
		for len(hunks) > 0 && hunks[0].oStart <= end {
			end = max(end, hunks[0].oStart+hunks[0].oLen)
			group = append(group, hunks[0])
			hunks = hunks[1:]
		}
		if len(group) == 1 {
			if h.abLen > 0 {
				side := a
				if h.b {
					side = b
				}
				results = append(results, region{stable: true, content: side[h.abStart : h.abStart+h.abLen]})
			}
		} else {
			// a true conflict: the bounds each side changed, corrected for the part of o the other side changed
			bounds := map[bool]*[4]int{false: {len(a), -1, len(o), -1}, true: {len(b), -1, len(o), -1}}
			for _, g := range group {
				bd := bounds[g.b]
				bd[0] = min(g.abStart, bd[0])
				bd[1] = max(g.abStart+g.abLen, bd[1])
				bd[2] = min(g.oStart, bd[2])
				bd[3] = max(g.oStart+g.oLen, bd[3])
			}
			ba, bb := bounds[false], bounds[true]
			aStart, aEnd := ba[0]+(start-ba[2]), ba[1]+(end-ba[3])
			bStart, bEnd := bb[0]+(start-bb[2]), bb[1]+(end-bb[3])
			results = append(results, region{
				aStart: aStart, aContent: slice(a, aStart, aEnd),
				oStart: start, oContent: o[start:end],
				bStart: bStart, bContent: slice(b, bStart, bEnd),
			})
		}
		offset = end
	}
	advanceTo(len(o))
	return results
}

// slice is s[from:to] clamped to s, as JavaScript's slice (for the bounds a conflict computes).
func slice(s []string, from, to int) []string {
	from, to = min(max(from, 0), len(s)), min(max(to, 0), len(s))
	if to < from {
		return nil
	}
	return s[from:to]
}
