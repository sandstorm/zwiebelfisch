# Custom styles MVP: declared style functions in the style menu

Status: open
Depends on: comments-drafting (shares the import helper and touches projection.ts; start after it is merged)
Touches: src/features/visual-view/projection/projection.ts, src/features/visual-view/nodes/nodes.ts, src/features/visual-view/toolbar/toolbar.ts, a new style discovery module in src/features/visual-view/, src/typst-editor/** (wiring project files → VisualView), src/typst-editor.css, ARCHITECTURE.md, docs/embedding.md

## Goal
Users of the Visual view can apply their own paragraph and character styles. A style is a
Typst function in a project file, declared with a doc comment:

```typst
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style text Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)
```

- **Style menu:**
  - The menu lists the declared paragraph styles after *Heading 3*.
  - Choosing one wraps the current block(s) in `#note[…]`. *Normal text* unwraps them.
  - Text styles toggle `#key[…]` around the selection.
  - The first use adds `#import "styles.typ": note` to the file, or extends the existing import.
    It is never duplicated.
- **Visual view:** styled content stays editable text, drawn with a generic frame (an accent
  bar and a name badge for blocks, a dotted underline with a tooltip for text). The frame has a
  CSS class `typst-style--<name>`.
- **New style:** a "New style…" entry appends a stub to `styles.typ`, creating the file when
  needed, and opens it in the Source view.

Concept: [docs/2026_10_10_custom-styles.md](../2026_10_10_custom-styles.md), option (a) and
section 5.

## Context
- **Discovery:** a deep module, `discoverStyles(files) → Style[]` with
  `Style = { name, kind: 'paragraph' | 'text', label, path }`.
  - The Lezer tree gives `LineComment "/// @style …"`, `Hash`, then
    `LetBinding > Closure > Ident, Params`.
  - A style needs exactly one required positional parameter.
- **Projection:** pass the declared names into `project()` (through `Context`).
  - A run that is exactly one `#name[..]` call (optionally with arguments before the content)
    becomes `styledBlock`. Its content is segmented like a table cell's (`blocks()`), and its
    source around the content is kept like `table.layout`.
  - Inline `#name[..]` becomes a `style` mark (attrs `name`), like the `link` mark for
    `#link(..)[..]`.
  - Undeclared calls stay raw boxes.
  - Optionally use the same mark for `underline`, `highlight`, `strike`, `smallcaps`, `sub` and
    `super`.
- **Position map and track changes** must cover the new node and mark: the hidden call syntax
  maps to the next visible position, as for links.
- **Import helper:** generalise the drafting import insertion from comments-drafting into
  `ensureImport(text, module, name)`.
- **Set rules do not cross `#import`.** That is fine here, because only functions are imported.

## Acceptance
- **vitest, discovery:** declared paragraph and text styles are found across files, with labels.
  Undeclared `#let`s and wrong signatures are ignored.
- **vitest, projection:**
  - `print(project(src)) === src` for fixtures with styled blocks, styled text, nested
    formatting inside them, calls with extra arguments, and undeclared calls.
  - An edit inside a styled block changes only that content.
  - Applying and removing a style prints `#note[…]` exactly.
  - The position-map invariants hold.
- **vitest, toolbar (jsdom):** the menu lists the declared styles and shows the current one.
  Applying a style adds the import once.
- **Playwright (needs a browser run by the user):** declare a style in `styles.typ`, apply it to
  a paragraph in the Visual view, then see `#note[…]` and the import in the Source view and the
  styled result in the preview. Edit the text inside, and unwrap with *Normal text*.
- `mise run quality` passes. ARCHITECTURE.md › VisualView is updated.

## Out of scope
- Editing a style's arguments or definition through a UI: that is the style panel (next step 2
  of the concept).
- CSS derived from the definition, and compiled swatches in the menu.
- Universe templates and label-based styles.
