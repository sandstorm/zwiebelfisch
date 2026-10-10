# Concept: custom styles in the Visual view

Status: done (branch task/concept-custom-styles)
Depends on: nothing
Touches: docs/2026_10_10_custom-styles.md, docs/todo/custom-styles-mvp.md, docs/todo/README.md

## Goal
Answer the user's question "custom styles somehow in the editor???": how people who work in the
Visual view can apply and manage their own styles (like Word's paragraph and character styles)
in a Typst document. Concept only, no code.

## Context
The style menu in `src/visual-view/toolbar.ts` is fixed (normal text, headings 1–3). Calls the
projection does not model become raw boxes, which show compiled snippets
(`rendered-box.ts`). Typst has no style registry: it uses functions, set and show rules,
labels and templates.

## Acceptance
- `docs/2026_10_10_custom-styles.md` covers these options with their trade-offs:
  - (a) `#let` style functions in the style menu;
  - (b) a set/show rule panel;
  - (c) labels with show rules;
  - (d) Universe templates.
- The concept compares the ways to render styled content (compiled snippet or CSS) and
  recommends an MVP and next steps.
- An MVP task file exists.

## Out of scope
Implementation.

## Outcome
- [docs/2026_10_10_custom-styles.md](../2026_10_10_custom-styles.md) recommends option (a) as
  the MVP:
  - style functions declared with a tidy-style `/// @style paragraph|text <Label>` doc comment;
  - offered in the style menu;
  - projected as an editable `styledBlock` node or `style` mark;
  - drawn as a generic frame with a name badge.
- Next steps, in order:
  1. compiled swatches in the menu;
  2. a style panel for a managed `template` function, which also gives CSS variables for the
     Visual view;
  3. an engine style probe;
  4. Universe templates;
  5. labels only on demand.
- Key Typst constraint recorded: set rules do not cross `#import`, so shared rules travel as a
  `#show: template` function.
- MVP task: [custom-styles-mvp](custom-styles-mvp.md).
