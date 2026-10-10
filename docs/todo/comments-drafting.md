# Comments as `drafting` margin notes in the Typst source

Status: open
Depends on: comments (done), visual-view-compiled-boxes, multi-file-assets-packages
Touches: src/comments/**, src/visual-view/** (new TipTap node), src/editor/**, src/collab/shared-comments.ts, ARCHITECTURE.md, docs/embedding.md

## Goal
The comment UI from the [comments](comments.md) task (sidecar JSON, side panel, preview markers)
feels odd: it is a separate layer next to the document. Instead, comments become part of the document,
written with the [`drafting`](https://typst.app/universe/package/drafting/) package
(`@preview/drafting:0.2.2`):

```typst
#import "@preview/drafting:0.2.2": margin-note, inline-note
Some text#margin-note[Is this number still right? — Anna]
```

- The **preview** shows the real margin notes the compiler draws. No more home-made markers.
- The **Visual view** gets a custom TipTap node (`marginNote`, inline atom) that shows the
  note as a small marker or bubble. Clicking it edits the note's content in place, like a raw box.
- The **Source view** shows them as ordinary Typst (optionally with a mark decoration).
- Comments travel with the file through git, collaboration (the Y.Text) and diffs for free.

This reverses the "never in the Typst source" decision of the comments task. The user decided this.

## Context
- drafting API: `margin-note(side:, stroke:, dy:)[body]`, `inline-note(par-break:)[body]`,
  `set-margin-note-defaults(hidden: bool, …)` (hidden → hide all notes for the final output),
  `note-outline()`. Margin notes need page margins (`set-page-properties`/`#set page(margin: …)`)
  and stop avoiding collisions after about 3 overlapping notes.
- Package loading: see multi-file-assets-packages. `@preview/drafting` must resolve in the
  engine. Add a fixture under `src/engine/fixtures/` for tests.
- Projection: `src/visual-view/projection.ts` maps Typst ↔ ProseMirror. A `margin-note` call
  is a function call in markup. Model it as its own node, not as a raw box.
- Existing pieces that may stay or go: `src/comments/` (Comments, anchor.ts, CommentsPanel,
  CommentsUI), `SharedComments` (Y.Map), `Preview.setMarkers`, widget options
  `comments`/`onCommentsChange`.

## Decisions (2026-10-10, user)
1. **Ranges:** use drafting's two-argument form, with no custom helper:
   `#margin-note[commented text][note]` highlights the range and puts the note in the margin.
   A comment on a collapsed cursor uses the one-argument form `#margin-note[note]`.
2. **Old system is removed:** `src/comments/` (Comments, anchors, CommentsPanel, CommentsUI),
   the `SharedComments` Y.Map, `Preview.setMarkers('comments')` and the widget options
   `comments`/`onCommentsChange`/`commentschange`/`.comments` go away. Notes live only in the
   Typst text, so collaboration, git and diffs cover them automatically.
3. **No threads:** there are no replies, and resolve means delete the note. Who wrote a note is part of
   its text, if anyone wants that.
4. **Import:** adding the first note inserts `#import "@preview/drafting:0.2.2": margin-note`
   at the top of the file, or extends an existing drafting import. It is never duplicated.
5. Hiding notes for final output (`set-margin-note-defaults(hidden: true)`) is left to the
   document author. It is not a widget option.

## Acceptance
- vitest: projection round-trips `#margin-note[…]` and `#margin-note[…][…]` ↔ TipTap
  nodes without changing the text. Inserting a note adds the import exactly once.
- vitest: engine compiles a document using the drafting fixture.
- Playwright: select text / place cursor in Visual view → "Comment" → note appears in the
  Visual view (TipTap node), Source view (Typst code) and preview margin. Editing the note in the
  Visual view updates source and preview.
- ARCHITECTURE.md › Review comments and docs/embedding.md updated. Removed APIs are listed.

## Out of scope
Mentions/notifications, permissions, migrating existing sidecar JSON (unless trivial).
