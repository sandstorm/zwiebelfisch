#import "../template.typ": mermaid

= Architecture overview <architecture-overview>

A Typst editor in the browser. Hosts are the mechanism of a view; extensions are every feature. All of them read and edit one text per file.

== Layers <architecture-overview-layers>

#table(
  columns: (auto, 1fr),
  table.header[Folder][Job],
  [`src/core/`], [Models: files, text, paths, the Typst engine, Typst syntax (@architecture-core).],
  [`src/hosts/`], [A view's mechanism and its contribution points, as small as possible: @architecture-visual-editor (conversion: @architecture-typst-conversion), @architecture-source-editor, @architecture-preview, @architecture-window. The extension host runs the extensions (@architecture-extensions-host).],
  [`src/extensions/`], [One folder per concept (headings, comments, files, …): every feature and every construct beyond paragraphs and raw Typst (@architecture-extensions-built-in).],
  [`src/editor/`], [`createEditor`, the composition root: `editor/widget` makes and wires the hosts for a `Project` (the Typst files' editors into the window, its settings onto it) and runs the built-in extensions.],
  [`src/editor-element/`], [`<zwiebelfisch-editor>`: a shadow root around `createEditor`.],
  [`src/testing/`], [Test helpers composing the built-ins; only `*.test.ts` files import it.],
)

- *Model:* `core/` and each extension's `model/`; no DOM.
- *View:* the hosts and an extension's view folders (`visual-editor/`, `source-editor/`, `preview/`, `window/`).
- *Controller:* an extension's `activate`: subscribes views to model events, turns input into `TextChange`s and `FileChange`s.

Who may import whom, and why extensions never depend on each other: @architecture-conventions.

== A keystroke's journey <architecture-overview-keystroke>

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 75%),
  caption: [A keystroke in the Visual editor; the numbers are the listeners' subscription order.],
)

- *Only what was touched:* the Visual editor writes back one change per edited textblock; untouched nodes print their source verbatim (@architecture-visual-editor-class).
- *The way back:* a Source editor edit reaches the Visual editor through `onDidChange`, which parses again and applies the smallest replacement (@architecture-typst-conversion-sync).

== One edit format, one source of truth <architecture-overview-truth>

Every `.typ` file is one `TypstDocument`; editors never talk to each other. Every edit is a `TextChange[]` with an `origin`, which suppresses echoes (@architecture-core-document).
