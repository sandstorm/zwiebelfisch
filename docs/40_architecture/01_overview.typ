#import "../template.typ": mermaid

= Architecture overview <architecture-overview>

The widget is a few models, a few view hosts, and extensions for everything else.

== Layers <architecture-overview-layers>

#table(
  columns: (auto, 1fr),
  table.header[Folder][Job],
  [`src/core/`], [Models: files, text, paths, the Typst engine, Typst syntax (@architecture-core).],
  [`src/hosts/`], [View hosts: the mechanism of a view plus its contribution points, no feature knowledge (@architecture-prosemirror-typst, @architecture-visual-editor, @architecture-source-editor, @architecture-preview, @architecture-workbench).],
  [`src/extensions/`], [One folder per concept (headings, comments, files, …): every feature and every construct beyond paragraphs and raw Typst (@architecture-built-in-extensions).],
  [`src/typst-editor/`], [`createTypstEditor`: a `Project` in the workbench host with the built-in extensions.],
  [`src/typst-editor-element/`], [`<typst-editor>`: a shadow root around `createTypstEditor`.],
  [`src/testing/`], [Test helpers composing the built-ins; only `*.test.ts` files import it.],
)

It is model, view and controller:

- *Model:* `core/` and each extension's `model/` folder. No DOM.
- *View:* the hosts and an extension's view folders (`visual-editor/`, `source-editor/`, `preview/`, `workbench/`).
- *Controller:* an extension's `activate`. It subscribes views to model events and turns input into `TextChange`s and `FileChange`s.

*Import rules* (checked by `mise run quality`, @architecture-conventions):

- `core/` imports only `core/`.
- Hosts never import extensions.
- Extensions never import each other. They meet through core models or a host's contribution point.
- From outside a module, import only its entry file.

== A keystroke's journey <architecture-overview-keystroke>

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 75%),
  caption: [A keystroke in the Visual editor; the numbers are the listeners' subscription order.],
)

The way back is the same: a Source editor edit reaches the Visual editor through `onDidChange`, which parses again and applies the smallest replacement (`applyTypstChanges`, @architecture-prosemirror-typst-sync).

== One edit format, one source of truth <architecture-overview-truth>

- *One text:* every `.typ` file is one `TypstDocument`. Editors never talk to each other.
- *One edit format:* `TextChange[]` (`from`, `to`: UTF-16 `SourceOffset`s; `insert`) with an `origin`.
- *Echo suppression:* an editor passes itself as `origin` and skips its own notifications (@architecture-core-document).
