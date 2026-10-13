package gitlab

import (
	"maps"
	"slices"
	"strings"
	"unicode/utf16"

	"typst-editor/server/lib/diff3"
)

// Merging texts: an upstream push merged into the room's edits (three-way, by lines), and the small edits
// that bring the merge into the room's Y.Text. Offsets are UTF-16 code units, as in the browser and Y.Text.

// merge3 merges the changes from base to current and from base to upstream. Where both changed the same
// (or adjacent) lines differently, it returns the conflicting ranges of current instead (ok false).
func merge3(base, current, upstream string) (merged string, conflicts []conflictRange, ok bool) {
	ours := lines(current)
	var out strings.Builder
	for _, r := range diff3.Merge(ours, lines(base), lines(upstream)) {
		if r.Conflict == nil {
			out.WriteString(strings.Join(r.OK, ""))
			continue
		}
		from := units(ours[:r.Conflict.AIndex]...)
		conflicts = append(conflicts, conflictRange{From: from, To: from + units(r.Conflict.A...)})
	}
	if len(conflicts) > 0 {
		return "", conflicts, false
	}
	return out.String(), nil, true
}

// textEdit replaces [From, To) (UTF-16, before any edit) with Insert.
type textEdit struct {
	From, To int
	Insert   string
}

// textEdits are small edits that turn from into to: the changed lines, each narrowed to the characters that
// differ, so text around them (and positions anchored there, like other users' cursors) stays untouched.
// Ascending, not overlapping.
func textEdits(from, to string) []textEdit {
	a, b := lines(from), lines(to)
	var edits []textEdit
	for _, h := range diff3.Diff(a, b) {
		start := units(a[:h.A]...)
		edits = append(edits, narrow(start, strings.Join(a[h.A:h.A+h.ALen], ""), strings.Join(b[h.B:h.B+h.BLen], "")))
	}
	return edits
}

// applyEdits is text with edits (ascending, offsets before any edit) applied.
func applyEdits(text string, edits []textEdit) string {
	u := utf16.Encode([]rune(text))
	for _, e := range slices.Backward(edits) {
		u = slices.Concat(u[:e.From], utf16.Encode([]rune(e.Insert)), u[e.To:])
	}
	return string(utf16.Decode(u))
}

// mergeFiles merges upstream's changes to a set of files (path → text) into the room's: changes is what to
// do to current (new text, or nil: delete). A file changed on both sides is merged by merge3; a file
// changed on one side and deleted on the other conflicts as a whole.
func mergeFiles(base, current, upstream map[string]string) (changes map[string]*string, conflicts []fileConflict) {
	changes = map[string]*string{}
	paths := map[string]bool{}
	for _, m := range []map[string]string{base, current, upstream} {
		for p := range m {
			paths[p] = true
		}
	}
	for _, path := range slices.Sorted(maps.Keys(paths)) {
		b, inBase := base[path]
		c, inCurrent := current[path]
		u, inUpstream := upstream[path]
		if same(u, inUpstream, b, inBase) || same(c, inCurrent, u, inUpstream) {
			continue
		}
		if same(c, inCurrent, b, inBase) {
			if inUpstream {
				changes[path] = &u
			} else {
				changes[path] = nil
			}
			continue
		}
		if !inCurrent || !inUpstream {
			conflicts = append(conflicts, fileConflict{Path: path, Ranges: []conflictRange{}})
			continue
		}
		if merged, ranges, ok := merge3(b, c, u); ok {
			changes[path] = &merged
		} else {
			conflicts = append(conflicts, fileConflict{Path: path, Ranges: ranges})
		}
	}
	return changes, conflicts
}

func same(a string, hasA bool, b string, hasB bool) bool { return hasA == hasB && a == b }

// lines are the lines of text, each with its line break (joined they give text back).
func lines(text string) []string {
	var out []string
	for len(text) > 0 {
		i := strings.IndexByte(text, '\n') + 1
		if i == 0 {
			i = len(text)
		}
		out = append(out, text[:i])
		text = text[i:]
	}
	return out
}

// units is the length of parts in UTF-16 code units.
func units(parts ...string) int {
	n := 0
	for _, p := range parts {
		for _, r := range p {
			n += utf16.RuneLen(r)
		}
	}
	return n
}

// narrow is the edit replacing removed (at start) with inserted, without their common prefix and suffix
// (compared by characters, so an edit never splits a surrogate pair).
func narrow(start int, removed, inserted string) textEdit {
	r, i := []rune(removed), []rune(inserted)
	limit := min(len(r), len(i))
	prefix := 0
	for prefix < limit && r[prefix] == i[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < limit-prefix && r[len(r)-1-suffix] == i[len(i)-1-suffix] {
		suffix++
	}
	return textEdit{
		From:   start + units(string(r[:prefix])),
		To:     start + units(string(r[:len(r)-suffix])),
		Insert: string(i[prefix : len(i)-suffix]),
	}
}
