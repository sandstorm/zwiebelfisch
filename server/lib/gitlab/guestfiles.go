package gitlab

import (
	"path"
	"reflect"
	"slices"
	"strings"

	"github.com/sandstorm/zwiebelfisch/server/lib/collab"
	"github.com/sandstorm/zwiebelfisch/server/lib/ydoc"
)

// guestEditable are the endings (in any case) of the files a guest may create, edit, rename and delete:
// Typst files, the images the widget shows (src/extensions/images/model/image-files.ts), Mermaid diagrams
// and IronCalc spreadsheets. Every other file is read-only to guests. Clients read the list from the room's
// meta.guestEditable.
var guestEditable = []string{".typ", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".mmd", ".ic"}

// guestMayChange is whether a guest may change the file at p.
func guestMayChange(p string) bool {
	return slices.Contains(guestEditable, strings.ToLower(path.Ext(p)))
}

// guarded is what of a room a guest may not change: the texts and other files that are not guestEditable,
// and the meta map.
type guarded struct {
	texts  map[string]string
	assets map[string]any
	meta   map[string]any
}

func readGuarded(doc *ydoc.Doc) guarded {
	g := guarded{
		texts:  doc.TextsOf(filesMap, func(p string) bool { return !guestMayChange(p) }),
		assets: map[string]any{},
		meta:   doc.Values(metaMap),
	}
	for p, value := range doc.Values(assetsMap) {
		if !guestMayChange(p) {
			g.assets[p] = value
		}
	}
	return g
}

// restore writes g where now differs from it.
func (g guarded) restore(w *ydoc.Writer, now guarded) {
	for p, text := range g.texts {
		if t, ok := now.texts[p]; !ok || t != text {
			w.SetText(filesMap, p, text)
		}
	}
	for p := range now.texts {
		if _, ok := g.texts[p]; !ok {
			w.Delete(filesMap, p)
		}
	}
	restoreValues(w, assetsMap, g.assets, now.assets)
	restoreValues(w, metaMap, g.meta, now.meta)
}

// restoreValues writes the values kept of root map m where now differs from them.
func restoreValues(w *ydoc.Writer, m string, kept, now map[string]any) {
	for key, value := range kept {
		if v, ok := now[key]; !ok || !reflect.DeepEqual(v, value) {
			w.Set(m, key, value)
		}
	}
	for key := range now {
		if _, ok := kept[key]; !ok {
			w.Delete(m, key)
		}
	}
}

// guestRefused is what a guest's client is told when the room undid their change to what is guarded.
const guestRefused = "Guests may change only Typst files, images, Mermaid diagrams and spreadsheets; your change to another file was undone."

// guard keeps what is guarded as it is against guests: after a guest's change to it the room writes it back
// (as the room's own change) and refuses the guest's client; after any other change it is what is kept. On
// the host's goroutine, in every update listener call, so nothing a guest changes there reaches anyone's
// operation (a commit, a merge) before it is written back.
func (r *room) guard(doc *ydoc.Doc, origin any) {
	now := readGuarded(doc)
	c, ok := origin.(client)
	if !ok || !c.User().IsGuest() || reflect.DeepEqual(now, r.guarded) {
		r.guarded = now
		return
	}
	kept := r.guarded
	r.logErr(r.write(doc, func(w *ydoc.Writer) { kept.restore(w, now) }), "cannot undo a guest's change")
	r.x.log.Warn().Str("project", r.project).Str("branch", r.branch).Str("guest", c.Name()).Msg("a guest changed what guests may not: undone, refused")
	if p, ok := origin.(interface{ Refuse(reason string) }); ok {
		p.Refuse(guestRefused)
	}
}

var _ interface{ Refuse(string) } = (*collab.Peer)(nil)
