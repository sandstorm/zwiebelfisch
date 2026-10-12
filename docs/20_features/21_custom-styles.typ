= Custom styles <features-custom-styles>
#set heading(outlined: false)

== What it does

A block or inline style is a Typst function with a `/// @style` doc comment, in any `.typ` file of the project (usually `styles.typ`). A tip box and a key cap, and a document using them:

#import "../template.typ": example
#example("/examples/custom-styles/main.typ", imports: ("/examples/custom-styles/styles.typ",))

- *block* wraps whole blocks (paragraphs, lists, headings). The Visual editor shows a named frame: *Tip* around the wrapped paragraphs, `#tip[…]` in the file.
- *inline* wraps a run of text inside a paragraph. The Visual editor shows it underlined: *Key* wraps the selection in `#key[…]`.
- The preview shows the real look, as above: the green bar of the tip, the frame of the key cap.
- The text style menu offers both and adds the import where needed.
- The bar above a text selection offers the inline styles too: Styles → *Key* (✓ where the selection has it: takes it off).
- *Normal text* removes a block style. "New style…" adds a block style to `styles.typ`.
- Search everywhere applies a style to the selection: `*` and its name (@features-search-everywhere).
- Calls of functions not declared as styles stay raw boxes (@features-full-typst-support).

== Why

A template's look (call-outs, warnings, terms) becomes a menu entry: writers apply it without writing the call, and the template author decides what it looks like.

== How to configure

Nothing to configure: the styles are the project's own, declared in its Typst files.
