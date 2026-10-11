#import "../template.typ": mermaid

= Architecture overview <architecture-overview>

== Layers <architecture-overview-layers>

#table(
  columns: (auto, 1fr),
  table.header[Folder][Job],
  [`src/core/`], [Models: files, text, paths, the Typst engine, Typst syntax. No DOM, no editor library, no Yjs. See @architecture-core.],
  [`src/hosts/`], [View hosts: the mechanism of a view plus its contribution points. No feature knowledge. @architecture-prosemirror-typst, @architecture-visual-editor, @architecture-source-editor, @architecture-preview, @architecture-workbench.],
  [`src/extensions/`], [One folder per concept (headings, comments, files, …). Every feature and every Typst construct beyond paragraphs and raw Typst. See @architecture-built-in-extensions.],
  [`src/typst-editor/`], [`createTypstEditor`: a `Project` in the workbench host with the built-in extension list.],
  [`src/typst-editor-element/`], [`<typst-editor>`: a shadow root around `createTypstEditor`.],
  [`src/testing/`], [Test helpers composing the built-ins; only `*.test.ts` files import it.],
)

Model, view and controller:

- *Model:* `core/` and every extension's `model/` folder. The line is the DOM.
- *View:* the hosts and an extension's view folders (`visual-editor/`, `source-editor/`, `preview/`, `workbench/`).
- *Controller:* an extension's entry. Its `activate` subscribes views to model events and turns input into `TextChange`s and `FileChange`s.

Import rules (checked by `mise run quality`, details in @architecture-conventions):

- `core/` imports only `core/`.
- Hosts never import extensions.
- Extensions never import each other. They meet through core models or a host's contribution point.
- From outside a module, only its entry file.

== A keystroke's journey <architecture-overview-keystroke>

Typing one letter in the Visual editor:

#figure(
  mermaid(read("../diagrams/keystroke.mmd"), width: 75%),
  caption: [A keystroke in the Visual editor; the numbers are the listeners' subscription order.],
)

The way back is the same with the roles swapped: a Source editor edit reaches the Visual editor through `onDidChange`, which parses the text again and applies the smallest replacement (`applyTypstChanges`, see @architecture-prosemirror-typst-sync).

== One edit format, one source of truth <architecture-overview-truth>

- The text of every `.typ` file is one `TypstDocument`. Views never talk to each other.
- Every edit is `TextChange[]` (`from`, `to`: `SourceOffset`s, UTF-16; `insert`) with an `origin`.
- A view passes itself as `origin` and skips its own notifications (@architecture-core-document).
