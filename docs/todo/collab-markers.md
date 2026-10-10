# Collaboration presence markers (carets, boxes, preview, file bar)
Status: done (branch task/collab-markers)
Depends on: collab-yjs
Touches: src/document/presence.ts (new), src/collab/remote-cursors.ts, src/collab/collaboration.ts,
src/source-view/presence.ts (new), src/source-view/source-view.ts, src/visual-view/presence.ts (new),
src/visual-view/highlights.ts, src/visual-view/raw-box.ts, src/visual-view/visual-view.ts,
src/preview/presence-markers.ts (new), src/preview/preview.ts, src/editor/file-switcher.ts,
src/editor/collaboration-link.ts, src/editor/typst-editor.ts, src/editor/styles.css, tests/e2e/collab.spec.ts

## Goal
Show where the other users are the way Tiptap's CollaborationCaret and y-codemirror do: a
coloured caret bar with a name flag (also on empty lines), coloured selections, an outlined box
when someone is inside a raw box / image / other atom, initials markers in the preview, and dots
on the files others are in.

## Context
Remote cursors were drawn as one-character highlight marks through `setHighlights('remote-cursors')`,
so a caret on an empty line was not drawn at all, and nothing showed in the preview or file bar.

**Decision: why not Tiptap's Collaboration / CollaborationCaret.** Both are built on
y-prosemirror, which makes the ProseMirror document (a Y.XmlFragment) the shared truth. Here the
Typst text is the truth (one Y.Text per file) and the Visual view is a projection of it (raw
boxes, pristine source printed verbatim; the Source view and the preview follow the text).
Syncing ProseMirror trees would bypass the projection and need a second, conflicting sync.
So the text-based Yjs sync stays; only the look of the markers follows Tiptap / y-codemirror.

## Acceptance
- vitest (jsdom): Visual caret widget at a position incl. an empty paragraph (empty table cell,
  and one made with Enter), raw box / image / inline box outline with names, carets drawn in a raw
  box's CodeMirror; Source caret on an empty line, selection, flag re-shown only on moves; preview
  marker placement (pure); file-bar dots; RemoteCursors through in-process Y.Docs; the link reports
  presence to the widget.
- Playwright (`tests/e2e/collab.spec.ts`, user-run via `mise run test:e2e-collab`): B sees A's
  named caret in both views and the preview marker; a caret on an empty line in the Source view.

## Out of scope
Showing remote selections inside raw boxes (only carets), follow-the-user / jump to a user,
presence for non-`.typ` files.

## Outcome
- `src/document/presence.ts`: `Presence {id, user: {name, color}, anchor, head}` (source
  offsets), `PlacedPresence` (+ `path`), `PresenceTarget.setPresence(presences)` — the one small
  interface both views implement; helpers `caretElement`, `flagTextColor` (WCAG black/white),
  `initials`, `presenceStyle`.
- `RemoteCursors` keeps awareness and relative positions; feeds `setPresence` of the shown file's
  views and `onPresence(everyone)` (changes only). `Collaboration.onPresence`,
  `LinkedWidget.onPresence`; the widget passes it to `Preview.showPresence` and
  `FileSwitcher.showPresence`. The `remote-cursors` highlight layer and `typst-remote-cursor` are gone.
- Source view (`source-view/presence.ts`): caret widget with dot; flag on hover and for 2.5 s after
  each move; selection marks. Reused in raw boxes.
- Visual view (`visual-view/presence.ts`): caret widget (flag always shown); selection through the
  highlight range decorations; a caret inside a box outlines it (`typst-remote-box`, names in the
  flag) and the raw box draws the carets in its nested CodeMirror.
- Preview: `presence-markers.ts` (pure) + `Preview.showPresence`: throttled `jumpFromCursor`
  lookups (250 ms, newest only, again after each compile), initials markers fanned out on the
  same spot.
- File bar: a dot with initials per user on their file.
- Needs a browser run: `mise run test:e2e-collab` (and a look at the caret/flag/box/marker CSS).

## Later changes (2026-10-10)
- Preview markers removed (user: "collab cursor also shown in Typst preview — why?"):
  `presence-markers.ts` and `Preview.showPresence` are gone.
- Off-by-one fix: the local selection was published on the DOM's `selectionchange`, read from the
  editors' state before they had applied the move, so others saw the previous position. The
  views now report selection changes themselves (`onSelection`).
