#import "../template.typ": mermaid

= Architecture overview <architecture-overview>

A Typst editor in the browser. Hosts are the mechanism of a view; extensions are every feature. All of them read and edit one text per file.

*Read next:* @architecture-extensions, how a feature is built; the chapters after it each end with how extensions hook into their part.

== Layers <architecture-overview-layers>

#figure(
  mermaid(read("../diagrams/overview-layers.mmd"), width: 95%),
  caption: [The folders of `src/`; an arrow means "imports".],
)

- *`core/`* (@architecture-core); *`hosts/`*: @architecture-visual-editor (conversion: @architecture-typst-conversion), @architecture-source-editor, @architecture-preview, @architecture-window, the extension host (@architecture-extensions-host); *`extensions/`*: one folder per concept (@architecture-extensions-built-in).
- *`editor/widget`* makes and wires the hosts for a `Project`; `src/testing/` composes the built-ins for `*.test.ts` only.
- *Model, view, controller:* `core/` and an extension's `model/` have no DOM; the hosts and an extension's view folders are the views; an extension's `activate` is the controller.

Who may import whom, and why extensions never depend on each other: @architecture-conventions.

== A keystroke's journey <architecture-overview-keystroke>

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 65%),
  caption: [A keystroke in the Visual editor; the numbers are the listeners' subscription order.],
)

- *Only what was touched:* untouched nodes print their source verbatim (@architecture-visual-editor-class).
- *The way back:* a Source editor edit reaches the Visual editor through `onDidChange`, which parses again and applies the smallest replacement (@architecture-typst-conversion-sync).

== One edit format, one source of truth <architecture-overview-truth>

Every `.typ` file is one `TypstDocument`; editors never talk to each other, and every edit is a `TextChange[]` with an `origin` (@architecture-core-document).
