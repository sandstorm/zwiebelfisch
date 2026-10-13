#import "../template.typ": mermaid, unreviewed

= Architecture overview <architecture-overview>

#unreviewed

The widget is a few models, a few view hosts, and extensions for everything else.

== Layers <architecture-overview-layers>

#table(
  columns: (auto, 1fr),
  table.header[Folder][Job],
  [`src/core/`], [Models: files, text, paths, the Typst engine, Typst syntax (@architecture-core).],
  [`src/hosts/`], [View hosts: the mechanism of a view plus its contribution points, no feature knowledge (@architecture-prosemirror-typst, @architecture-visual-editor, @architecture-source-editor, @architecture-preview, @architecture-workbench).],
  [`src/extensions/`], [One folder per concept (headings, comments, files, …): every feature and every construct beyond paragraphs and raw Typst (@architecture-extensions-built-in).],
  [`src/editor/`], [`createEditor`: a `Project` in the workbench host with the built-in extensions.],
  [`src/editor-element/`], [`<zwiebelfisch-editor>`: a shadow root around `createEditor`.],
  [`src/testing/`], [Test helpers composing the built-ins; only `*.test.ts` files import it.],
)

- *Model:* `core/` and each extension's `model/` folder. No DOM.
- *View:* the hosts and an extension's view folders (`visual-editor/`, `source-editor/`, `preview/`, `workbench/`).
- *Controller:* an extension's `activate`. It subscribes views to model events and turns input into `TextChange`s and `FileChange`s.

Who may import whom, and why extensions never depend on each other: @architecture-conventions.

== A keystroke's journey <architecture-overview-keystroke>

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 75%),
  caption: [A keystroke in the Visual editor; the numbers are the listeners' subscription order.],
)

The way back is the same: a Source editor edit reaches the Visual editor through `onDidChange`, which parses again and applies the smallest replacement (`applyTypstChanges`, @architecture-prosemirror-typst-sync).

== One edit format, one source of truth <architecture-overview-truth>

Every `.typ` file is one `TypstDocument`; editors never talk to each other. Every edit is a `TextChange[]` with an `origin` (echo suppression: @architecture-core-document).
