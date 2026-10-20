#import "../template.typ": mermaid, unreviewed

= Typst ↔ ProseMirror: the Visual editor's conversion <architecture-typst-conversion>

#unreviewed

The Visual editor's model (@architecture-visual-editor): it turns Typst text into the editor's #link("https://prosemirror.net/")[ProseMirror] document and back, so that an edit changes only the source of what it touched. A stateless library in the Visual editor host, `src/hosts/visual-editor/typst-conversion/`; a module of its own: extensions, the workbench and the editor import its entry `typst-conversion/typst-conversion.ts` directly. Shaped like prosemirror-markdown (`TypstToProseMirrorParser`, `ProseMirrorToTypstSerializer`), no view, tested without a DOM.

#figure(
  mermaid(read("../diagrams/typst-prosemirror.mmd"), width: 60%),
  caption: [Typst text to the ProseMirror document and back.],
)

*Invariant:* `serializeToTypst(parseTypst(text, schema)) === text` for any input.

== Specs and grammar <architecture-typst-conversion-specs>

The framework knows only paragraphs, text, escapes, shorthands and raw Typst (a line break `\` without `markup`: a raw inline box). Every other construct is a spec:

#table(
  columns: (auto, 1fr),
  table.header[Field][Meaning],
  [`name`], [The node or mark type.],
  [`tiptap`], [The Tiptap extension defining the type (schema, attributes, priority).],
  [`typst.parseTypst`], [Which syntax it reads: `syntaxNodes` by Lezer node name (`Heading`, `Strong`), `calls` by function name (`*`: any other call).],
  [`typst.toTypst`], [How an edited node is written back.],
  [`typst.labelled`, `anchors`, `container`], [Takes a trailing label; attributes kept like `src`; the container of consecutive items (list items → their list).],
)

- *Attaching:* `createSchema(nodes, marks)` (tests) or `documentExtensions` + `attachGrammar` (the Visual editor) put the specs on the schema, where `parseTypst` and `serializeToTypst` find them.
- A second spec of the same name extends the first; order between specs: @architecture-extensions-rules.
- Writing a spec: @architecture-visual-editor-constructs.

== Parsing <architecture-typst-conversion-parse>

- *Segments:* syntax whose rule `standsAlone` (headings, list items) is a block of its own; everything else runs up to a paragraph break.
- *Runs:* a run with prose becomes a paragraph; a run that is exactly one call goes to the `calls` rules; what no rule takes becomes `rawBlock` / `rawInline` holding its source verbatim.
- *Labels:* a label right after a heading, or ending a run, becomes the block's `label` attribute.
- *Context:* rules get a `TypstParseContext` (see the d.ts).
- *List items* are read without their common indentation and printed with it again.

== Source anchors and nodes unchanged since parsed <architecture-typst-conversion-anchors>

- *Anchors:* attributes that are never rendered and remember the source: `src` (the node's Typst), `sep` (whitespace to the next sibling), the document's `lead` and `trail`, `label`, and each spec's `anchors`.
- *Unchanged since parsed:* a private `WeakMap` (`unchangedNodes`) holds the nodes `parseTypst` made. ProseMirror keeps the identity of unchanged nodes, so membership means "still equal to `src`".
- *Printing:* unchanged nodes and block atoms print `src`; edited nodes print through their spec's `toTypst` (textblocks by default: their inline content, escaped).
- Editor-made nodes have `sep: null` and get the default separator.

== Position map <architecture-typst-conversion-position-map>

```ts
sourceToPos(doc, offset: SourceOffset, bias?) → number        // ProseMirror position
posToSource(doc, pos: number, bias?) → SourceOffset
```

The only conversion between source offsets and document positions, character-exact, for any document.

- *Built while printing:* each stretch of output records the document range showing it (text one to one, atoms as a whole, hidden syntax to the next visible position).
- `bias: -1` maps a range end to just after the visible character before it.

== Sync <architecture-typst-conversion-sync>

`applyTypstChanges(tr, target)` turns the current document into a fresh parse:

1. Diff both with the anchor attributes stripped, so a changed `src` does not replace a whole block.
2. Replace only the innermost changed range: a cursor elsewhere in the paragraph stays put.
3. Copy the attributes over and mark nodes unchanged since parsed again where the target's were.
