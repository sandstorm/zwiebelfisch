package gitlab

import (
	"fmt"
	"strings"
)

// Who edited a room since its last commit, how often and since when; and the commit messages naming them.

// person is someone who edits, as a commit names them (Co-authored-by: Name <Email>).
type person struct{ Name, Email string }

// editors is the tally of a room's edits not committed yet, by editor (a name; the first person seen under
// it), counted per change of the document. A commit takes the tally and puts it back if it did not happen
// (restore), so edits made while it runs stay for the next one. The zero value is empty.
type editors struct {
	since int64 // milliseconds since the epoch of the first edit not committed; 0: none
	order []string
	by    map[string]*editor
}

type editor struct {
	person person
	edits  int
}

// edited counts an edit by p at (ms since the epoch); nil: someone unknown (counted in since only).
func (e *editors) edited(p *person, at int64) {
	if e.since == 0 {
		e.since = at
	}
	if p == nil {
		return
	}
	if ed := e.by[p.Name]; ed != nil {
		ed.edits++
		return
	}
	if e.by == nil {
		e.by = map[string]*editor{}
	}
	e.by[p.Name] = &editor{*p, 1}
	e.order = append(e.order, p.Name)
}

// take hands over the tally and starts an empty one.
func (e *editors) take() editors {
	taken := *e
	*e = editors{}
	return taken
}

// restore puts a taken tally back (its edits came first), with the edits made since it was taken.
func (e *editors) restore(taken editors) {
	later := *e
	*e = editors{since: taken.since}
	if e.since == 0 {
		e.since = later.since
	}
	for _, t := range []editors{taken, later} {
		for _, name := range t.order {
			ed := t.by[name]
			if mine := e.by[name]; mine != nil {
				mine.edits += ed.edits
				continue
			}
			e.edited(&ed.person, e.since)
			e.by[name].edits = ed.edits
		}
	}
}

// names are the editors' names, in the order of their first edit.
func (e *editors) names() []string { return append([]string{}, e.order...) }

// mostEdits is the editor with the most edits (the first of them on a tie); nil when nobody is known.
func (e *editors) mostEdits() *person {
	var best *editor
	for _, name := range e.order {
		if ed := e.by[name]; best == nil || ed.edits > best.edits {
			best = ed
		}
	}
	if best == nil {
		return nil
	}
	return &best.person
}

// withCoAuthors is message with a Co-authored-by trailer per editor (the convention GitLab shows). The
// commit's author is the server's bot, so everyone who edited is named here.
func withCoAuthors(message string, e editors) string {
	if len(e.order) == 0 {
		return message
	}
	var b strings.Builder
	b.WriteString(message + "\n")
	for _, name := range e.order {
		p := e.by[name].person
		fmt.Fprintf(&b, "\nCo-authored-by: %s <%s>", p.Name, p.Email)
	}
	return b.String()
}

// automaticMessage is the message of a commit the server makes by itself: "Edits by Ann, Bob:
// chapters/intro.typ, results.typ" (at most namedPaths paths), the editors as co-authors.
func automaticMessage(e editors, paths []string) string {
	shown := paths
	if len(shown) > namedPaths {
		shown = shown[:namedPaths]
	}
	var parts []string
	for _, p := range shown {
		parts = append(parts, strings.TrimPrefix(p, "/"))
	}
	subject := "Edits"
	if len(e.order) > 0 {
		subject = "Edits by " + strings.Join(e.order, ", ")
	}
	subject += ": " + strings.Join(parts, ", ")
	if len(paths) > namedPaths {
		subject += fmt.Sprintf(" and %d more", len(paths)-namedPaths)
	}
	return withCoAuthors(subject, e)
}

// namedPaths is how many paths a generated commit message names; it counts the others.
const namedPaths = 3
