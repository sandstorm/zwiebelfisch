#import "../template.typ": api, mermaid, unreviewed

= Typst ↔ ProseMirror: the Visual editor's conversion <architecture-typst-conversion>

#unreviewed

The Visual editor's model (@architecture-visual-editor): Typst text to its #link("https://prosemirror.net/")[ProseMirror] document and back, so an edit changes only the source of what it touched. A stateless library in `src/hosts/visual-editor/typst-conversion/`, shaped like prosemirror-markdown, tested without a DOM; extensions, the widget and the editor import its entry `typst-conversion.ts` directly.

#figure(
  mermaid(read("../diagrams/typst-prosemirror.mmd"), width: 60%),
  caption: [Typst text to the ProseMirror document and back.],
)

== Specs <architecture-typst-conversion-specs>

#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "DocumentNodeSpec")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstNodeConversion", docs: "first-sentence")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstParseRules", docs: "first-sentence")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstMarkSpec")
#api("/src/hosts/visual-editor/typst-conversion/typst-conversion.ts", "TypstMarkConversion", docs: "first-sentence")

- *The framework knows only* paragraphs, text, escapes, shorthands and raw Typst (a line break `\` without `markup`: a raw inline box). Every other construct is a spec; writing one: @architecture-visual-editor-constructs, their order: @architecture-extensions-rules.
- *Parsing:* syntax that `standsAlone` (headings, list items) is a block of its own; everything else runs up to a paragraph break. A run with prose is a paragraph, a run that is exactly one call goes to the `calls` rules, and what no rule takes is `rawBlock` / `rawInline`, its source verbatim.

== Nodes unchanged since parsed <architecture-typst-conversion-anchors>

- *Anchors* are attributes never rendered that remember the source: `src`, `sep` (whitespace to the next sibling), the document's `lead` and `trail`, `label`, and each spec's `anchors`.
- *Unchanged since parsed:* a private `WeakMap` holds the nodes `parseTypst` made. ProseMirror keeps the identity of unchanged nodes, so membership means "still equal to `src`": such nodes print `src`, edited ones their spec's `toTypst`. Editor-made nodes have `sep: null` and get the default separator.

== Position map <architecture-typst-conversion-position-map>

`sourceToPos` and `posToSource` are the only conversion between source offsets and ProseMirror positions, character-exact, for any document. The map is built while printing: each stretch of output records the document range showing it (text one to one, atoms as a whole, hidden syntax to the next visible position).

== Sync <architecture-typst-conversion-sync>

`applyTypstChanges(tr, target)` turns the current document into a fresh parse:

1. Diff both with the anchor attributes stripped, so a changed `src` does not replace a whole block.
2. Replace only the innermost changed range: a cursor elsewhere in the paragraph stays put.
3. Copy the attributes over and mark nodes unchanged since parsed again where the target's were.
