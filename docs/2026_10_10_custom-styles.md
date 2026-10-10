# Custom styles in the Visual view

Date: 2026-10-10. Concept only, no code. Answers the question: "custom styles somehow in the editor???"
How can people who work in the Visual view apply and manage their own styles, like Word's
paragraph and character styles, in a Typst document?

## 1. What a "style" is in Typst and in Word

Word keeps a **registry of named styles** (`styles.xml`). Every paragraph or run refers to one by
name, and "Modify style" changes all of them at once.

Typst has no registry. It has three mechanisms that together cover the same ground:

| Word | Typst idiom | Example |
|---|---|---|
| Paragraph style ("Note", "Quote") | a function that takes content and returns a block | `#let note(body) = block(fill: luma(240), inset: 8pt, body)` → `#note[…]` |
| Character style ("Keyword") | a function that returns inline content | `#let key(body) = text(fill: blue, weight: "bold", body)` → `#key[…]` |
| Modify built-in style ("Heading 1": font, size, colour) | set and show rules | `#show heading.where(level: 1): set text(size: 18pt, fill: navy)` |
| Style variant of an element ("Heading 1 – warning") | a label plus a show rule | `= Careful <warning>` with `#show <warning>: set text(red)` |
| Document template (`.dotx`) | a template function used with `#show:`, often a Universe package | `#show: ieee.with(title: [..])` |

Two Typst facts shape every option below:

- **Set and show rules are scoped.** A `#set` in `styles.typ` does *not* reach a file that
  imports it. Shared rules must travel as a **template function**
  (`#let template(doc) = { set text(..); show heading: ..; doc }`). The main file applies it with
  `#show: template`. `#import` carries only functions and variables.
- **Everything is source.** A style is Typst text in a project file. Like the margin notes in
  [comments-drafting](todo/comments-drafting.md), the user decided that document data lives in
  the Typst source. Styles therefore travel through git, collaboration (the Y.Text), diffs and
  the CLI with no extra work. No sidecar style registry.

## 2. What the codebase does today

- **Style menu** (`src/visual-view/toolbar.ts`, `STYLES`): a fixed table with *Normal text* and
  *Heading 1–3*. Each entry is a Tiptap chain command, and `currentStyle()` finds the selected
  entry with `editor.isActive`. The menu is the natural place for custom paragraph styles.
- **Projection** (`src/visual-view/projection.ts`):
  - A run that is exactly one `#func(..)` call goes through `blockCall()`. Only `image` and
    `table` are modelled. `#note[…]` becomes a `rawBlock` today.
  - Inside a paragraph, any call except `#link("..")[..]` becomes a `rawInline`.
  - `#link` is the precedent for a call whose syntax is hidden while its content stays editable
    text: the call becomes a `link` mark.
  - **Table cells** show that a `[..]` content argument can hold projected blocks
    (`blocks(ctx, segments)`) and print back with the source around it kept (`table.layout`
    gaps). A styled block needs exactly this.
- **Raw boxes** (`raw-box.ts`) and **rendered boxes** (`rendered-box.ts`):
  - While it is not focused, `#note[…]` already *looks* right: it shows the compiled snippet cut
    from the preview pages (`Preview.snippet`).
  - It is not editable as text, though: clicking it opens Typst code.
  - Boxes that start with `#set`/`#show`/`#let`/`#import` always show code (`rendersInPlace`).
- **Visual view CSS** (`src/editor/styles.css`) uses fixed sizes (`.typst-visual h1 { font-size: 1.6em }`).
  It does not react to the document's set rules.
- **Engine** (`crates/typst-engine`): compile, jumps and `boxes_for_ranges`. There is no query or
  introspection API yet. `@preview` packages load from packages.typst.org, and multi-file
  projects exist (`ProjectFiles`).

## 3. Options

### (a) Styles as `#let` functions, offered in the style menu

A style is a function in a project file, for example `styles.typ`:

```typst
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style text Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)
```

- **Applying a paragraph style** wraps the paragraph: `#note[The paragraph text.]`. Choosing
  *Normal text* unwraps it. Several paragraphs or a list can be wrapped together, because `[..]`
  may contain paragraph breaks.
- **Applying a character style** wraps the selection: `… a #key[term] in …`, just as bold
  becomes `#strong[..]`.
- **Import:** the first use adds `#import "styles.typ": note` to the main file, or extends an
  existing import of that file. It is never duplicated. This is the same helper that
  comments-drafting needs for `@preview/drafting`; it should be generalised once
  (`ensureImport(text, module, name)`).
- **Discovery.** Two ways:
  1. *Parse every `#let name(..) = …`* in the project. This offers too much: helpers like
     `#let total(x)` show up as styles, and the syntax alone does not tell a block from an
     inline function.
  2. *A doc-comment declaration* (`/// @style paragraph|text <Label>`) on the `#let`. It is
     explicit, gives a display name and the kind, and costs one line per style. `///` is the
     convention of [tidy](https://typst.app/universe/package/tidy/), Typst's documentation
     generator. Package authors already write these comments, and they are ignored by the
     compiler.

  **Recommended: the declaration.** The Lezer tree (`typstParser` from codemirror-lang-typst) has
  `LineComment "/// …"`, then `Hash`, then `LetBinding > Closure > Ident, Params`, so discovery is
  a walk over top-level nodes. A style function must have exactly one required positional parameter
  (the body). Named parameters with defaults are allowed, and the MVP ignores them.
- **Projection:**
  - A new block node `styledBlock` (attrs: `name`, `src`, `sep`, plus a layout like
    `table.layout` for the source around the content) holds blocks.
  - A new mark `style` (attrs: `name`) covers inline spans.
  - Unknown or non-declared calls stay raw boxes, so the projection must know the style names.
    Pass a set of names into `project()` (as part of `Context`). Re-project when the set changes,
    which is what `syncDoc` already does for outside changes.
  - A small allowlist of built-in character functions (`underline`, `highlight`, `strike`,
    `smallcaps`, `sub`, `super`) can use the same mark for free.
- **Trade-offs:**
  - Pro: The most idiomatic option: it is the Typst way to write "semantic" markup, it works
    unchanged in the CLI and the web app, and the content stays editable prose.
  - Con: It needs a convention, which documents not written in our editor will lack. Those still
    work: their calls stay raw boxes rendered as snippets.
  - Con: Arguments (`#callout(kind: "warning")[..]`) are not editable in the MVP. They are kept
    verbatim in the layout.

### (b) Set and show rules edited through a style panel

This is Word's "Modify style" dialog. A panel lists elements (*Body text*, *Heading 1–3*,
*Lists*, *Links*, *Page*) with fields (font, size, weight, colour, spacing, alignment,
numbering, margins). It writes rules into a **managed template function** in `styles.typ`:

```typst
#let template(doc) = {
  set text(font: "Libertinus Serif", size: 11pt)
  set heading(numbering: "1.")
  show heading.where(level: 1): set text(size: 18pt, fill: rgb("#1f3a5f"))
  doc
}
```

The main file gets `#show: template` once (with the import).

- **Editing:** each field is a minimal text edit of one argument value, like the projection's
  minimal changes. A missing rule is inserted and a reset field removes its argument.
  - The panel understands only literal arguments of `set`/`show … : set …` lines inside the
    managed function.
  - Anything else (closures, conditionals) stays untouched and is shown as "custom code",
    opening the Source view.
- **Also covers styles from (a):** the panel can edit the literal arguments of a declared
  style's body (`block(fill: …, inset: …)`) with the same machinery.
- **Trade-offs:**
  - Pro: A familiar UI that needs no Typst knowledge. A heading's look changes everywhere at once.
  - Pro: It feeds the CSS approximation (section 4) directly.
  - Con: It works only on a constrained subset of Typst: a parser and editor for the managed
    region, plus a field per property. This means a lot of UI.
  - Con: It is about *modifying* built-in elements, not *applying* new styles. It complements (a)
    and does not replace it.

### (c) Labels and show rules

```typst
#show <warning>: it => block(stroke: red, inset: 6pt, it)
= Careful <warning>
#[A whole paragraph that is a warning.] <warning>
```

- **Applying** appends `<warning>` to an element. For headings this is very good: the element
  stays a heading, so the outline, numbering and the Visual view's heading node keep working.
- **Trade-offs:**
  - Con: An element has **only one label**, and labels are also what `@ref` points at. A styled
    heading can no longer be referenced by its own name, so styles and references compete.
  - Con: A label after plain paragraph text attaches to the preceding inline element, not to the
    paragraph. To style a paragraph, you have to write `#[..] <warning>`, which is clumsier than
    `#warning[..]`.
  - Con: The projection would need a label attribute on every block kind. The parser gives the
    `Label` as a sibling after the `Heading` node, not as its child.
- **Use:** only for *variants of modelled elements* (a heading style), later, if users ask
  for it.

### (d) Template packages from Typst Universe

```typst
#import "@preview/charged-ieee:0.1.3": ieee
#show: ieee.with(title: [A paper], authors: (..))
```

- **What it gives:** a complete, professionally made look with no design work. Many templates
  also export content functions (`#abstract[..]`, `#appendix[..]`), which are exactly the
  paragraph styles of (a).
- **In the editor:**
  - A "Start from template" picker lists templates (Universe's `typst.toml` `[template]` section:
    `path`, `entrypoint`, `thumbnail`).
  - "Document settings" is a form for the `.with(..)` arguments.
  - The package's tidy `///` comments offer its functions in the style menu, the same discovery
    as (a). Packages that use `/// @style` would be ideal, but none do yet.
- **Trade-offs:**
  - Pro: This is the best result for the least effort, and it is the Typst ecosystem's own answer.
  - Con: There are no machine-readable parameter schemas: the `.with()` form would rely on parsing
    signatures and defaults, and the README for the rest.
  - Con: Versions are pinned and packages are downloaded (offline is not possible).
  - Con: The template's set rules are not visible to our CSS (section 4) without an engine probe.

## 4. How the Visual view renders custom-styled content

| Approach | Fidelity | Editable inline | Cost |
|---|---|---|---|
| **Compiled snippet** (exists: `RenderedBox`) | exact | no: click shows code | none, already there for raw boxes |
| **Generic frame**: styled block with an accent bar and a name badge ("Note"); styled text with a dotted underline, the name in a tooltip, class `typst-style--note` | none (honest "this is a Note") | yes | small CSS |
| **CSS from literal arguments**: map `text(fill, size, weight, style, font)` and `block(fill, stroke, inset, radius)` to `color`, `font-size`, `background`, `border`, `padding`, … | partial | yes | parser plus a mapping; fragile beyond literals |
| **CSS from an engine probe**: compile `#import "styles.typ": *` + `#note[Sample]`, then read the fill shapes and the glyph runs (font, size, colour) of the frame back | good for simple styles | yes | new engine API (`style_probe`) and a frame walker, next to `boxes_for_ranges` |
| **Swatch**: compiled snippet of `#note[Sample text]` in the style menu | exact | n/a (menu only) | the probe compile, no frame walking |

- **Editable text with a compiled picture behind it does not work.** Typst's line breaking, font
  metrics and page geometry differ from the browser, so an overlay would drift. Fully exact
  rendering of a style means a picture, and a picture means editing code.
- **The useful split:**
  - The *menu* shows exact swatches (compiled).
  - The *text* shows an approximation that stays editable (CSS).
  - The *preview* next to it is the truth.
- The same CSS path serves (b): the template's `set text(font: ..)` and
  `show heading.where(level: 1): set text(size: ..)` become CSS variables on `.typst-visual`.
  Fonts can come from the engine's font bytes through `FontFace`. The Visual view then looks
  like the document without per-node work.

## 5. Recommendation

### MVP: option (a), declared style functions with a generic frame

1. **Discovery:** `/// @style paragraph|text [Label]` above a `#let` with one required content
   parameter, in any `.typ` file of the project. This is a small deep module
   (`discoverStyles(files) → Style[]`, with `Style = { name, kind, label, path }`).
2. **Style menu:** after *Heading 3*, a separator, then the paragraph styles. A second menu, or
   a group under the paragraph styles, holds the text styles.
   - Applying a paragraph style wraps the current block(s).
   - *Normal text* unwraps.
   - Applying a text style toggles the mark on the selection.
   - Both add the import once.
3. **Projection:** a `styledBlock` node and a `style` mark for calls of declared names whose only
   argument is one trailing content block. Calls with extra arguments keep them verbatim and
   still project.
   - Round-trip invariant `print(project(src)) === src`.
   - Edits inside change only the content.
   - Undeclared calls stay raw boxes, exactly as today.
4. **Rendering:** the generic frame and badge, with a class per style name so a host can add
   CSS.
5. **Creating a style:** a "New style…" menu entry appends a stub
   (`/// @style paragraph <Name>` and `#let <name>(body) = block(inset: 8pt, body)`) to
   `styles.typ`, creating the file when needed, and opens it in the Source view. No panel yet.

This needs no engine change and reuses known patterns: the `link` mark, the table-cell blocks,
`blockCall` and the import helper. It also turns existing raw boxes into editable text as soon
as their function is declared.

### Next steps, in order

1. **Swatches** in the style menu: one probe compile per styles file change, using the
   snippet machinery.
2. **Style panel (b)** for a managed `template` function, with the CSS variables in the Visual
   view derived from its set and show rules. This step is what makes "Heading 1" look like the
   document.
3. **Engine style probe**, so that (a) styles get CSS approximations instead of the generic
   frame.
4. **Universe templates (d):** the picker, a `.with()` form, and discovery of package functions
   through tidy comments.
5. **Labels (c)** for heading variants, only if users ask for them.

Open questions for the user:
- Is `styles.typ` the agreed file name? Should the panel own a `template` function in it?
- Is one menu with two sections enough, or should text styles get their own toolbar control?
