# Labels and references in the Visual view: tags and @-mention chips

Status: done (branch task/labels-and-references)
Depends on: restructure-src (done)
Touches: features/visual-view (projection, nodes, a new references/ subfolder), toolbar (maybe), CSS

## Goal (user, 2026-10-10)
1. **References** like `@method`, `@results`, `@fig:compile-times` (and `@key[supplement]`) are
   inline elements in the Visual view, not raw boxes. They are created like mentions (Tiptap
   Mention-style suggestion): typing `@` opens a list of the project's labels, which can be filtered by
   typing, with keyboard navigation, and Enter inserts. The chip shows the label (`method`), plus
   a hint of the target (e.g. "Section · Method", "Figure · Compile times") when it is known.
2. **Labels** like `= Introduction <intro>` (and `#figure(..) <fig:x>`, equations `$ … $ <eq:1>`,
   paragraphs ending in `<x>`) are not a separate line or raw box. They show as a small tag/badge on
   the element they label. They are editable there (click → small field; rename = edit the label
   text). Later the Inspector edits them too (see inspector-sidebar.md, it is a natural Inspector
   field). Removing the tag removes the label.

## Notes
- Typst syntax: `@key` / `@key[supplement]` is a `Ref` node in the Lezer tree; `<key>` a `Label`.
  A label attaches to the preceding element. In markup that is the heading, figure or equation it follows
  (on the same line or as the next token).
- Round-trip exactly: label spacing (`= Intro <intro>` vs `= Intro<intro>`), refs with supplements,
  refs right before punctuation (`@method.` — Typst's ref ends at the label chars; check how `.`
  is treated: `@fig:x.` → the ref is `fig:x`).
- Label index for the suggestion list: collect labels from all project files (the Project has all
  `.typ` documents) via a cheap scan (Lezer parse or regex over `<...>`), kept up to date on
  changes. Hint text from the labelled element (heading text, figure caption). A deep module with a small
  interface, e.g. `LabelIndex.labels() → [{name, kind, title, path}]`.
- Unknown reference (no such label): the chip is marked (wavy underline), and its tooltip explains. That matches
  Typst's own error, which the diagnostics already show.
- Renaming a label: offer "Rename and update N references" in the tag field. It edits all `@label`
  refs in the project as one change per file (one undo step in the current file).
- Bibliography keys (`@knuth1984` from a `.bib`) are out of scope unless trivial. Show them as
  references without a hint.

## Acceptance
- vitest: projection round-trips for refs (plain, supplement, before punctuation, in headings/lists/
  table cells/captions) and labels (headings, figures, equations, paragraphs; with/without space);
  the label index (multi-file, updates on change); suggestion filtering; insert ref; edit/remove a label tag;
  rename with references.
- Playwright (user-run): type `@` in the Visual view → list shows `intro`, `fig:…` → Enter inserts
  the chip → source has `@intro`; click the heading's tag → rename → refs updated.

## Outcome
- Projection: `@key` / `@key[supplement]` → `reference` inline atom (round-trips; text typed right
  after one is escaped so it cannot extend the name). A label after a heading (same or next line)
  or ending a block's run (paragraph, figure, equation, code block, table, table-cell paragraph)
  is the block's `label` attribute `{ name, gap }`, printed after it. Labels mid-paragraph, after
  which text follows on the heading line, inside list items, or doubled (`<a> <b>`) stay raw.
- `features/labels`: `LabelIndex` (deep module, `ProjectLabels` interface): labels of all `.typ`
  files with kind and title, `.bib` keys, reference counts, `renameReferences` across files;
  notifies only when the label list changes.
- `visual-view/references/`: chips with hints / wavy unknown marker; label tags (click → rename,
  "Rename and update N references", remove); own `@` suggestion plugin (not `@tiptap/suggestion`:
  it needs `@floating-ui/dom`, mounts into `document.body` and its outside-click check breaks in
  the shadow DOM); `@name` + space/punctuation also makes a chip.
- `FieldPopover` got an optional `alternative` button. No toolbar changes.
- Tests: `projection/labels-and-references.test.ts` (advanced example chapters as fixtures),
  `labels/labels.test.ts`, `references/label-edits.test.ts`, `label-choices.test.ts`,
  `references.dom.test.ts`; Playwright `tests/e2e/visual-references.spec.ts` (not run here).
- Left for later: the Inspector field for labels; adding a label to an unlabelled block from the
  Visual view (`setLabel` exists, no UI); `@` completion in the Source view (the index is ready).
