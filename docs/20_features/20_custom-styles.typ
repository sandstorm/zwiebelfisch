= Custom styles <features-custom-styles>
#set heading(outlined: false)

== What it does

A block or inline style is a Typst function with a `/// @style` doc comment, in any `.typ` file of the project (usually `styles.typ`). A call-out box and a term style:

```typ
/// @style block Note
#let note(body) = block(inset: 8pt, stroke: (left: 2.5pt + blue), body)

/// @style inline Term
#let term(body) = text(fill: blue, style: "italic", body)
```

```typ
#import "styles.typ": note, term

Typst compiles #term[incrementally]: it redoes only what an edit touches.

#note[The numbers in this report are illustrative.]
```

- *block* wraps whole blocks (paragraphs, lists, headings). The Visual editor shows a named frame: *Note* around the wrapped paragraphs, `#note[…]` in the file.
- *inline* wraps a run of text inside a paragraph. The Visual editor shows it underlined: *Term* wraps the selection in `#term[…]`.
- The preview shows the real look: the blue bar of the note, the blue italics of the term.
- The text style menu offers both and adds the import where needed.
- The bar above a text selection offers the inline styles too: Styles → *Term* (✓ where the selection has it: takes it off).
- *Normal text* removes a block style. "New style…" adds a block style to `styles.typ`.
- Search everywhere applies a style to the selection: `*` and its name (@features-search-everywhere).
- Calls of functions not declared as styles stay raw boxes (@features-full-typst-support).

== Why

A template's look (call-outs, warnings, terms) becomes a menu entry: writers apply it without writing the call, and the template author decides what it looks like.

== How to configure

Nothing to configure: the styles are the project's own, declared in its Typst files.
