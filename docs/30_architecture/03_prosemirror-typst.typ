#import "../template.typ": mermaid

= Typst ↔ ProseMirror <architecture-prosemirror-typst>

Turns Typst text into the Visual editor's ProseMirror document and back, so that an edit changes only the source of what it touched. Plain ProseMirror: no view, no Tiptap editor, tested without a DOM. Module `src/hosts/prosemirror-typst/`.
Shaped like prosemirror-markdown: a schema plus a parser (`TypstToProseMirrorParser`) and a serializer (`ProseMirrorToTypstSerializer`).

#figure(
  mermaid(read("../diagrams/typst-prosemirror.mmd"), width: 60%),
  caption: [Typst text to the ProseMirror document and back.],
)

Invariant: `serializeToTypst(parseTypst(text, schema)) === text` for any input.

== Specs and grammar <architecture-prosemirror-typst-specs>

The framework knows only paragraphs, text, line breaks, escapes, shorthands and raw Typst. Every other construct is a spec:

#table(
  columns: (auto, 1fr),
  table.header[Field][Meaning],
  [`name`], [The node or mark type.],
  [`tiptap`], [The Tiptap extension defining the type (schema, attributes, priority).],
  [`typst.parseTypst`], [Which syntax it reads: `syntaxNodes` by Lezer node name (`Heading`, `Strong`), `calls` by function name (`*`: any other call).],
  [`typst.toTypst`], [How an edited node is written back.],
  [`typst.labelled`, `anchors`, `container`], [Takes a trailing label; attributes kept like `src`; the container of consecutive items (list items → their list).],
)

- `createSchema(nodes, marks)` (tests) or `documentExtensions` + `attachGrammar` (the Visual editor) put the specs on the schema. `parseTypst` and `serializeToTypst` find them there.
- Order: the priority of each spec's Tiptap extension (default 100, higher first). Of rules for the same syntax, the higher one is asked first.
- A second spec of the same name extends the first.
- Writing a spec: @extensions-visual-editor-constructs.

== Parsing <architecture-prosemirror-typst-parse>

- Markup is cut into segments: syntax whose rule `standsAlone` (headings, list items) is a block of its own; everything else runs up to a paragraph break.
- A run with prose (text or inline syntax a spec models) becomes a paragraph. A run that is exactly one call goes to the `calls` rules. What no rule takes becomes `rawBlock` / `rawInline` holding its source verbatim.
- A label right after a heading, or ending a run, becomes the block's `label` attribute.
- Rules get a `TypstParseContext`: the source, the schema, and the framework's steps (`inline`, `blocks`, `itemBlocks`, `textblock`, `raw`).
- A list item's body is read on its own, its further lines without their common indentation: a paragraph, then nested lists and other blocks. Printing indents its lines after the first again (empty lines stay empty), so an item reads back byte for byte and an edited one keeps its indentation.

== Source anchors and nodes unchanged since parsed <architecture-prosemirror-typst-anchors>

- *Anchors:* attributes that are never rendered and remember the source: `src` (the node's Typst), `sep` (whitespace to the next sibling), the document's `lead` and `trail`, `label`, and each spec's `anchors`.
- *Unchanged since parsed:* a private `WeakMap` (`unchangedNodes`) holds the nodes `parseTypst` made. ProseMirror keeps the identity of unchanged nodes, so membership means "still equal to `src`".
- Nodes unchanged since parsed print `src`. Edited nodes print through their spec's `toTypst` (textblocks by default: their inline content, escaped). Block atoms print `src`.
- Editor-made nodes have `sep: null` and get the default separator.

== Position map <architecture-prosemirror-typst-position-map>

`sourceToPos(doc, offset: SourceOffset, bias?)` → ProseMirror position and `posToSource(doc, pos, bias?)` → `SourceOffset` map between source offsets and document positions, character-exact, for any document. The only conversion between the two: positions stay ProseMirror's plain numbers, offsets are typed.

- Printing records, for each stretch of output, the document range showing it: text one to one, atoms as a whole, hidden syntax to the next visible position in its block.
- Cached per document (documents are immutable).
- `bias: -1` maps a range end to just after the visible character before it.

== Sync <architecture-prosemirror-typst-sync>

`applyTypstChanges(tr, target)` turns the current document into a fresh parse:

1. Diff both with the anchor attributes stripped, so a changed `src` does not replace a whole block.
2. Replace only the innermost changed range: a cursor elsewhere in the paragraph stays put.
3. Copy the attributes over and mark nodes unchanged since parsed again where the target's were.
