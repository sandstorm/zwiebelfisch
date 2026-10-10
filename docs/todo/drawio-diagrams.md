# Diagrams: `.drawio.png` edited with the diagrams.net editor

Status: done (2026-10-11; asked for on 2026-10-10, confirmed the same day). E2E spec written, to be run by the user
(`tests/e2e/diagrams.spec.ts`, a stub page at the editor's URL speaks the protocol).
Depends on: the extension architecture ([2026_10_10_extensions-architecture.md](../2026_10_10_extensions-architecture.md)),
the spreadsheets extension (same "a file opens in its own embedded editor" pattern, binary updates)
Touches: new `src/extensions/diagrams/`, the workbench's file views (→ custom editors, below),
`extensions/images` (Visual image box tool), `extensions/files` (new-file entries), ARCHITECTURE.md,
docs/embedding.md

## What was built
- **Custom editors** (`hosts/workbench/custom-editors/`): `workbench.registerCustomEditorProvider(viewType,
  { resolveCustomEditor(document, panel) }, { filenamePattern, priority })` replaced `registerFileView(kind)`. A
  glob over the file name (`*`, `**`, `?`, `{a,b}`; with `/` over the path; case-insensitive); the highest priority
  opens a file (`'default'` = 100, `'option'` only via `open(path, { viewType })`), then the most specific pattern,
  then registration order. Every open gets a fresh panel; `panel.onDidDispose` fires while its element is still in
  place. `images.preview` (`*.{png,jpg,jpeg,gif,svg,webp}`), `images.file` (`*`), `spreadsheets.editor` (`*.ic`),
  `diagrams.editor` (`*.drawio.png`, 110). `core/paths` keeps only `ProjectPath.isTypst`; the media types and
  `imageBlob` moved to `extensions/images/model/image-files.ts`; the file panel picks icons by name.
- **New-file entries**: menu items in `file/newFile` (the UI-services wave replaced `registerNewFileTemplate` with
  menus): "New spreadsheet…" (`spreadsheets.newSpreadsheet`) and "New diagram…" (`diagrams.newDiagram`), each asking
  for a name in the row's folder (input box), creating the file and opening it.
- **Box actions** (`visualView.registerBoxAction({ title, when?(node, view), run(node, view) })`): a generic button
  on raw boxes, shown in the box's tools (the image toolbar) or above its code. "Edit diagram" is one; it finds the
  diagram through the workbench's document links (no Typst parsing in the extension).
- **`extensions/diagrams/`**: `diagrams()` with the setting `diagrams.editorUrl` (default
  `https://embed.diagrams.net/`); `model/` `EmbedSession` (init → load xmlpng + autosave; autosave → export xmlpng,
  one at a time → save after 800 ms quiet, last export wins; `flush` saves the pending export and puts a newer diagram
  into the last PNG), `png.ts` (tEXt `mxfile` chunk, URI-encoded, CRC), `emptyDiagram()`; `workbench/`
  `DiagramEditor` (iframe, messages only from its own window, `dark=1` with the widget's scheme and a reload on change,
  "could not be loaded" after 20 s / offline with "Show as image"), `newDiagram`; `visual-view/` `editDiagramAction`.
- Not done: renaming an open diagram while a save is pending saves to the old path (refused, an error message); an
  export still in flight when the file is closed is replaced by the XML-only save (picture follows on the next edit).

## Goal
People draw diagrams in the editor and use them in the document as ordinary images:
`#image("diagrams/architecture.drawio.png")`. A `.drawio.png` is a PNG with the diagram's XML
embedded, so Typst shows it as an image and diagrams.net can open it again for editing.

- Opening a `.drawio.png` shows the **diagrams.net editor**, embedded in an iframe
  (`https://embed.diagrams.net/?embed=1&proto=json&…`), like IronCalc for `.ic`.
- **Auto-save**: no Save button. Every change is written back to the `.drawio.png` (debounced), and
  the preview updates. With `autosave=1` the editor sends `autosave` messages; the extension then
  asks for `export` with `format: 'xmlpng'` and writes the returned PNG (XML embedded) through
  `Project.apply({ kind: 'update', content: Uint8Array })`. Last export wins; pending saves are
  flushed when the file is closed or the widget is destroyed.
- "New diagram…" creates an empty `.drawio.png` (a valid PNG with an empty diagram) and opens it.
- In the Visual view, an image box showing a `.drawio.png` offers "Edit diagram" (opens the file).
- Dark mode: the editor follows the widget's scheme (`ui=dark` / the embed's dark option), like
  the IronCalc dark mode item.

## Design (extension architecture)
- `extensions/diagrams/`: `diagrams.ts` (entry, `diagrams({ editorUrl? })`), `model/` (the
  postMessage protocol as pure state: handshake, autosave → export → save; the empty diagram;
  PNG round-trip helpers), `workbench/` (the iframe custom editor, "New diagram…"), `visual-view/`
  (the "Edit diagram" box tool, registered through the image box's tools contribution point).
- **Custom editors instead of `registerFileView(kind)`** (VS Code's model):
  `workbench.registerCustomEditorProvider(viewType, provider, { filenamePattern, priority:
  'default' | 'option' | number })`; the most specific / highest match opens the file. Spreadsheets
  `*.ic`, images `*.{png,jpg,jpeg,gif,svg,webp}` (+ data files), diagrams `*.drawio.png` (higher).
  `core`'s `FileKind` keeps only what core needs (Typst vs. other).
- New-file entries: a workbench contribution point (`registerNewFileTemplate({ label, suggestedName,
  create() })`) the files panel shows, so diagrams (and spreadsheets) don't import `files`.
- Host option for the editor URL (default `https://embed.diagrams.net/`; self-hostable, the drawio
  webapp is Apache-2.0). Without network the custom editor shows why and offers the image view.
- Collaboration: binary files are not merged; the last save wins, as for images today.

## Context
- Embed mode protocol (https://www.drawio.com/doc/faq/embed-mode): the editor sends `init`; the
  host sends `load` (`xml` or `xmlpng` data URI, `autosave: 1`); `autosave` / `save` / `exit` come
  back; `export` with `format: 'xmlpng'` returns a PNG data URI with the diagram embedded.

## Acceptance
- vitest: the protocol with a fake iframe window (`init` → `load`, `autosave` → `export` →
  project update, debounce, flush on close); PNG round trip keeps the XML; custom editor selection
  by pattern + priority (`a.drawio.png` → diagrams, `a.png` → images).
- Playwright (user runs it; needs network or a stub page speaking the protocol): open a diagram,
  draw, see the file update and the preview change without pressing Save.

## Out of scope
- `.drawio` / `.drawio.svg` variants (same path later).
- Real-time co-editing of a diagram.
