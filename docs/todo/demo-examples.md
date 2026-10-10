# Demo examples (simple / advanced)
Status: done (branch task/demo-examples)
Depends on: multi-file-ui (file bar for the advanced project)
Touches: demo/**, vite.config.ts (vitest include), tests/e2e/demo-examples.spec.ts

## Goal
The demo (`mise run dev`) offers example projects to pick from, so the editor can be tried on
more than the one-paragraph "Hello Typst" document:
- a small switcher at the top of the page; `?example=<name>` in the URL; `?room=` and `?user=`
  keep working; the older `?files` opens the advanced example;
- **Simple**: one file with the basics (headings, emphasis, lists, math, a link, a table);
- **Advanced**: a realistic multi-file report: `main.typ` applies `template.typ` via
  `#show: template.with(...)`, chapters in `chapters/` via `#include`, a local helper module
  via `#import`, SVG images in the project, `#outline()`, figures with captions and references,
  a numbered equation, a code block.

## Context
- Sources are real files under `demo/examples/<name>/`, loaded with `import.meta.glob` (`?raw`),
  not template strings. `.typ` files are text, everything else is passed as bytes.
- The e2e specs open `/` and expect the "Hello Typst" document, so it stays the default
  (`hello`), byte for byte.

## Acceptance
- vitest (`demo/examples.test.ts`): every example compiles with the bundled engine and fonts
  without errors or warnings; the default document is unchanged; URL parameter handling.
- Playwright (`tests/e2e/demo-examples.spec.ts`): default, simple, advanced, switching keeps
  other parameters, `?files`.

## Out of scope
- Collaboration rooms: a room's content wins over the chosen example (as before with `?files`).
- Binary assets other than SVG (would need `?url` + fetch).

## Outcome
- `demo/examples.ts` (deep module for the demo): `EXAMPLES`, `exampleFiles(name)` (project file
  map), `exampleFromQuery(params)`, `exampleQuery(name, params)`. `demo/main.ts` only wires it to
  the switcher and `createTypstEditor({ files })`.
- Three examples: `hello` (default, the previous demo document), `simple`, `advanced`
  (3 A4 pages: title + outline, introduction/method, results with table and SVG chart).
- Switcher: `<nav aria-label="Examples">` with one link per example (`aria-current` on the open
  one); switching reloads the page.
- vitest picks up `demo/**/*.test.ts` too.
- Not run here (no browser in the sandbox): `tests/e2e/demo-examples.spec.ts` and the existing
  specs that open `/` (layout now has a bar above the editor) need `mise run test:e2e`.
