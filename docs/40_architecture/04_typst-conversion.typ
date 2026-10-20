#import "../template.typ": mermaid, unreviewed

= Typst ↔ ProseMirror: the Visual editor's conversion <architecture-typst-conversion>

#unreviewed

The Visual editor's model (@architecture-visual-editor): Typst text to its #link("https://prosemirror.net/")[ProseMirror] document and back, so an edit changes only the source of what it touched. A stateless library in `src/hosts/visual-editor/typst-conversion/`, shaped like prosemirror-markdown, tested without a DOM; its entry is `typst-conversion.ts`.

- *Both ways:* `parseTypst` makes the document, whose nodes keep their source; an edit becomes `typstChanges(tr)`, one `TextChange` per textblock; a change from elsewhere comes back through `applyTypstChanges`.

== Specs <architecture-typst-conversion-specs>

*The framework knows only* paragraphs, text, escapes, shorthands and raw Typst. Every other construct is a spec: a node or mark with its parse rules (which syntax nodes and calls it takes) and its `toTypst`. Writing one: @architecture-visual-editor-constructs; their order: @architecture-extensions-rules.

#figure(
  mermaid(read("../diagrams/typst-conversion-parse.mmd"), width: 48%),
  caption: [How markup becomes blocks.],
)

== Nodes unchanged since parsed <architecture-typst-conversion-anchors>

*Anchors* are attributes never rendered that remember the source: `src`, `sep` (whitespace to the next sibling), the document's `lead` and `trail`, `label`, and each spec's `anchors`.

- *Printing:* a node unchanged since parsed prints its `src`; an edited or new one its spec's `toTypst`. Both build the Typst text and the position map.
- *Unchanged since parsed* means "still equal to `src`": ProseMirror keeps the identity of unchanged nodes, and the schema's conversions hold the nodes `parseTypst` made weakly.
- *Editor-made nodes* have `sep: null` and get the default separator.

== Position map <architecture-typst-conversion-position-map>

`sourceToPos` and `posToSource` are the only conversion between source offsets and ProseMirror positions, character-exact. The map is built while printing: text one to one, atoms as a whole, hidden syntax to the next visible position.

== Sync <architecture-typst-conversion-sync>

`applyTypstChanges(tr, target)` turns the current document into a fresh parse (`target`): diff without anchors, replace the innermost changed range, copy the anchors over and mark the nodes unchanged again.

- *Without anchors*, so a changed `src` does not replace a whole block; *innermost*, so a cursor elsewhere in the paragraph stays put.

== How extensions hook in <architecture-typst-conversion-extensions>

An extension adds a construct as a spec (`visualEditor.registerNode` / `registerMark`, with its parse rules and `toTypst`); writing one, with a real example: @architecture-visual-editor-constructs.
