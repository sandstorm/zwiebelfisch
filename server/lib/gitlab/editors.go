package gitlab

import (
	"fmt"
	"strings"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
)

// Who edited a room since its last commit, how often and since when; and the commit messages naming them.

// person is someone who edits: the user they signed in as, and how a commit names them (Co-authored-by:
// Name <Email>).
type person struct {
	User        collab.User
	Name, Email string
}

// key is who p is to the tally: the user (by provider and id), else (no id) the name.
func (p person) key() string {
	if p.User.ID != "" {
		return "user\x00" + p.User.Provider + "\x00" + p.User.ID
	}
	return "name\x00" + p.Name
}

// editors is the tally of a room's edits not committed yet, by editor (person.key; the first person seen
// under it), counted per change of the document. A commit takes the tally and puts it back if it did not happen
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
	key := p.key()
	if ed := e.by[key]; ed != nil {
		ed.edits++
		return
	}
	if e.by == nil {
		e.by = map[string]*editor{}
	}
	e.by[key] = &editor{*p, 1}
	e.order = append(e.order, key)
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
		for _, key := range t.order {
			ed := t.by[key]
			if mine := e.by[key]; mine != nil {
				mine.edits += ed.edits
				continue
			}
			e.edited(&ed.person, e.since)
			e.by[key].edits = ed.edits
		}
	}
}

// people are the editors, in the order of their first edit.
func (e *editors) people() []person {
	people := make([]person, 0, len(e.order))
	for _, key := range e.order {
		people = append(people, e.by[key].person)
	}
	return people
}

// names are the editors' names, in the order of their first edit.
func (e *editors) names() []string {
	names := make([]string, 0, len(e.order))
	for _, p := range e.people() {
		names = append(names, p.Name)
	}
	return names
}

// userIDs are the editors' user ids, in the order of their first edit ("": none known, or a guest's).
func (e *editors) userIDs() []string {
	ids := make([]string, 0, len(e.order))
	for _, p := range e.people() {
		if p.User.IsGuest() {
			ids = append(ids, "")
		} else {
			ids = append(ids, p.User.ID)
		}
	}
	return ids
}

// find is the editor who signed in as user (nil: they did not edit).
func (e *editors) find(user collab.User) *person {
	if user.ID == "" {
		return nil
	}
	if ed := e.by[person{User: user}.key()]; ed != nil {
		return &ed.person
	}
	return nil
}

// mostEdits is the editor with the most edits (the first of them on a tie); nil when nobody is known.
func (e *editors) mostEdits() *person {
	var best *editor
	for _, key := range e.order {
		if ed := e.by[key]; best == nil || ed.edits > best.edits {
			best = ed
		}
	}
	if best == nil {
		return nil
	}
	return &best.person
}

// withCoAuthors is message with a Co-authored-by trailer (the convention GitLab shows) per editor but the
// commit's author.
func withCoAuthors(message string, e editors, author person) string {
	var b strings.Builder
	b.WriteString(message)
	sep := "\n\n"
	for _, p := range e.people() {
		if p.key() == author.key() {
			continue
		}
		fmt.Fprintf(&b, "%sCo-authored-by: %s <%s>", sep, p.Name, p.Email)
		sep = "\n"
	}
	return b.String()
}

// parseCoAuthors are the people of message's Co-authored-by trailers (in its last paragraph, as
// withCoAuthors writes them), in their order.
func parseCoAuthors(message string) []Signature {
	paragraphs := strings.Split(strings.TrimRight(strings.ReplaceAll(message, "\r\n", "\n"), "\n"), "\n\n")
	var out []Signature
	for _, line := range strings.Split(paragraphs[len(paragraphs)-1], "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok || !strings.EqualFold(strings.TrimSpace(key), "Co-authored-by") {
			continue
		}
		name, email, ok := strings.Cut(strings.TrimSuffix(strings.TrimSpace(value), ">"), "<")
		if !ok || strings.TrimSpace(name) == "" {
			continue
		}
		out = append(out, Signature{Name: strings.TrimSpace(name), Email: strings.TrimSpace(email)})
	}
	return out
}

// automaticMessage is the message of a commit the server makes by itself, by author: "Edits by Ann, Bob:
// chapters/intro.typ, results.typ" (at most namedPaths paths), the other editors as co-authors.
func automaticMessage(e editors, paths []string, author person) string {
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
		subject = "Edits by " + strings.Join(e.names(), ", ")
	}
	subject += ": " + strings.Join(parts, ", ")
	if len(paths) > namedPaths {
		subject += fmt.Sprintf(" and %d more", len(paths)-namedPaths)
	}
	return withCoAuthors(subject, e, author)
}

// namedPaths is how many paths a generated commit message names; it counts the others.
const namedPaths = 3
