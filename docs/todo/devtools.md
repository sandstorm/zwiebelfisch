# Devtools: seeing what the editor does

Status: planned (decided 2026-10-11)
Touches: package.json (dev dependency), demo/, later a new `src/extensions/devtools/`

## 1. ProseMirror dev tools in the demo (now)
`prosemirror-dev-tools` (4.3.0, dev dependency, peer React — already a dependency) attached to the
Visual view's ProseMirror view in the **demo only**, switched on with `?devtools`: document tree and
JSON with node attributes (the projection's `src` / `sep` anchors), selection, transaction history
with diffs, plugin states, the schema in order (which is where Tiptap priorities show). Not part of
the library bundle. It needs the Visual view's editor view for the demo: reach it through the public
extension API (e.g. a tiny demo-only extension with a Visual-view editor-extension contribution that
receives the view), not through a widget internal.

## 2. Our own devtools extension (later)
A dev-only extension (not in the built-in list; a host adds it via `extensions`) with a side panel
showing what generic tools can't:
- the projection: Typst source ↔ Visual document side by side, the source range each block claims and
  which spec / extension claimed it, raw boxes and why;
- every contribution by extension: nodes and marks with their Tiptap priority, toolbar groups / items,
  box renderers, link providers, PDF options, custom editors, menus, commands, keybindings, settings
  with their values;
- events as they fire (file changes, document changes with origin, configuration changes).
Built only on the public extension API, so it doubles as a completeness check of that API.
