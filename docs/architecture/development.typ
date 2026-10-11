= Development <architecture-development>

Every operation is a mise task (`mise-tasks/`, `mise tasks ls`). Tools are pinned to exact versions in `mise.toml` and `package.json`.

== Tasks <architecture-development-tasks>

#table(
  columns: (auto, 1fr),
  table.header[Task][What it does],
  [`install`], [JS dependencies (frozen lockfile) and Playwright's browsers],
  [`deps:lock`], [after a `package.json` change: install and update `pnpm-lock.yaml`],
  [`dev`], [Vite dev server for `demo/` on 127.0.0.1:5199 (Local mode needs nothing else)],
  [`demo`], [the playground: Vite + the collaboration server with a fake GitLab on `ws://127.0.0.1:1234` (@architecture-development-demo)],
  [`build:engine`], [Rust → wasm (`cargo`, `wasm-bindgen`, `wasm-opt -Oz`) into `src/core/typst-engine/wasm/`; skipped when the Rust sources are unchanged],
  [`build:fonts`], [the default fonts of the pinned typst-assets crate into `src/core/typst-engine/fonts/`],
  [`build`], [typecheck, engine, fonts, library, then the static demo → `dist/demo`],
  [`build:lib`], [the library → `dist/lib`: ESM, worker, wasm, d.ts],
  [`typecheck`], [`tsc` over the widget, demo, tests and server],
  [`quality`], [ESLint (complexity, module boundaries, layers), `quality:top-comments`, `quality:module-cycles`],
  [`quality:report`], [every function ranked by complexity (hot spots)],
  [`test:unit`], [vitest over `src/`, `demo/`, `eslint-rules/`; the engine runs as real wasm],
  [`server:test`], [the server's vitest suite, Hocuspocus in-process, no port],
  [`test:e2e`], [builds demo and library, then Playwright in chromium, firefox, webkit (or one: `test:e2e chromium`)],
  [`test:e2e-collab`], [in-memory server + the two-user spec (`tests/e2e/collab.spec.ts`)],
  [`test:e2e-gitlab`], [fake-GitLab server + the GitLab room spec (`tests/e2e/gitlab.spec.ts`)],
  [`test:all`], [`test:unit`, `server:test`, `test:e2e`],
  [`server:dev`], [the collaboration server with SQLite in `server/.data/` (@architecture-server)],
  [`server:dev-fake-gitlab`], [the playground server alone],
  [`check:examples`], [every demo example compiled with the Typst CLI],
  [`fixtures:packages`], [test packages `src/**/fixtures/<name>-<version>/` packed as `.tar.gz` (committed)],
  [`fixtures:demo-spreadsheet`], [the advanced example's `data/compile-times.ic`],
  [`docs:pdf`], [this book → `dist/docs/typst-editor.pdf`],
  [`docs:html`], [these pages (Typst's bundle export) → `dist/docs/html/`],
)

== Checks before a commit <architecture-development-checks>

```sh
mise run typecheck
mise run quality
mise run test:unit
mise run server:test   # when server/ or core/room-protocol changed
```

#table(
  columns: (auto, auto),
  table.header[Lint limit][Value],
  [cognitive complexity], [12],
  [cyclomatic complexity], [10],
  [nesting depth], [3],
  [lines per function (tests exempt)], [60],
  [parameters], [4],
)

- Boundaries and layers: ESLint rules in `eslint-rules/` (`local/entry-imports`, `local/no-re-exports`, `local/dependencies`), configured in `eslint.config.js`. Exceptions are listed there with their reason and should shrink.
- `stylesheets.test.ts`: every `.css` under `src/` parses without error recovery, has no nested rules, and uses hex colors only in token definitions.

== Tests <architecture-development-tests>

- *Unit* (vitest, `*.test.ts` next to the code): node by default; DOM tests opt in with `// @vitest-environment jsdom` (setup: `tests/jsdom-setup.ts`). Model tests never need jsdom.
- *End-to-end* (Playwright, `tests/e2e/*.spec.ts`): against the static build `dist/demo` and `examples/` (+ `dist/lib`), served through request interception, so no port is opened.
- Test packages (`greet`, `drafting`, `cheq`) sit next to the tests using them.
- Agents in the sandbox cannot launch a browser or bind ports: they write Playwright specs, and the user runs `mise run test:e2e`.

== Manual demo checklist <architecture-development-demo>

Every user-visible feature, tried by hand in `mise run demo` on one machine: no real GitLab, no secrets, only localhost. The server (`server/src/fake-gitlab-main.ts`, in memory) serves plain rooms and `gitlab:demo/report@<any branch>` from a fake GitLab holding the advanced example. Restart `mise run demo` to reset it, or use a fresh branch. URLs: @guide-getting-started-demo.

#table(
  columns: (auto, 1fr),
  table.header[Playground bar][What it does],
  [Examples], [Hello (one file), Simple (lists, math, link, table), Advanced (template, chapters, helpers, SVG images, a spreadsheet), Documentation (`docs/**/*.typ`, nothing saved); disabled in GitLab mode],
  [Mode: Local], [the default; no server contacted (the static e2e build)],
  [Mode: Collaborate], [room `playground-<example>`; the first to join seeds it, then the room's text wins],
  [Mode: GitLab (fake)], [`gitlab:demo/report@main`],
  [Name], [the name next to your cursor, the author of comments and commits (Enter applies it)],
  [Open a second window as Bob], [the same room as the next user (Ann → Bob → Cleo → Dan)],
  [Simulate upstream commit], [GitLab mode: the fake GitLab commits to the branch and sends the push webhook. "add a paragraph" appends to `chapters/introduction.typ`; "revise a heading" changes its first heading (a conflict)],
  [status], [whether the server is reachable; if not, the command to start it, and the page edits a local copy],
)

Each row: mode / example, steps, what you should see, and the spec that also covers it (`test:e2e`; `collab.spec` in `test:e2e-collab`, `gitlab.spec` in `test:e2e-gitlab`).

#table(
  columns: (auto, 1.3fr, 1.3fr, 1fr),
  table.header[Feature][Try][Expect][Covered by],
  table.cell(colspan: 4)[*Editing views and preview* (Local)],
  [Visual / Source], [Hello: switch tabs, edit in each], [the other view and the preview follow; cursor and undo survive a switch], [visual, preview],
  [Live preview], [type in either view], [updates while typing; earlier pages untouched], [preview],
  [Preview → source], [click a word in the preview], [the view selects it; the run is outlined], [preview],
  [Follow cursor], [move the cursor ("Follow cursor" on, then off)], [the preview scrolls only when the spot is off-screen; off: stays], [preview-ux],
  [Zoom, page number], [Advanced: zoom buttons, scroll], [fit width by default, 25–400 %, "page n / total"], [preview-ux],
  [Errors], [type `#foo(` in Source], [last good pages kept, dimmed; status bar "1 error"], [preview-ux],
  table.cell(colspan: 4)[*Visual view* (Local)],
  [Headings, marks], [Simple: `## ` at a line start; Mod+B / Mod+I], [a heading; source gets `==`, `*x*`, `_x_`], [visual, visual-toolbar],
  [Lists], [Enter, then Tab in an item], [a new item, then a nested one], [visual],
  [Links], [Mod+K with a URL; remove it again], [`#link("…")[…]` appears and goes], [visual-links-tables],
  [Tables], [Simple: edit a cell; Insert table, Add row, Delete column], [only that cell's `[…]` changes], [visual-links-tables],
  [Real-world tables], [Advanced `chapters/results.typ`: change a `ms(..)` box, type after it, edit the caption, Add row, Header row off / on], [a table with caption, not a raw box; edits touch only their argument], [visual-tables-real-world],
  [Raw boxes], [Hello: click the equation, edit, Escape], [code while focused, the compiled snippet otherwise (inverted in the dark)], [visual-compiled-boxes, dark-mode],
  [Code], [Advanced `chapters/method.typ`: edit the `ts` block and its Language; Mod+E], [fence and language update; Mod+E toggles inline code], [visual-toc-and-code],
  [Table of contents], [Hello: toolbar Table of contents], [an `#outline()` box rendering the headings], [visual-toc-and-code],
  [Alignment], [Align left / Center / Align right / Justify (Mod+Shift+L/E/R/J)], [`#align(center)[…]`, `#par(justify: true)[…]`; the current one pressed], [visual-text-align],
  [Labels, references], [Advanced `chapters/introduction.typ`: type ` @fi`, Enter; rename the heading's `intro` tag], [`<intro>` tag, chips with hints, `@` lists the project's labels; renaming updates every file], [visual-references],
  [Diagnostics], [type `#nope` in a paragraph], [wavy underline with tooltip (boxes outlined), lint in Source, status bar jumps to it], [preview-ux],
  table.cell(colspan: 4)[*Images and figures* (Local / Advanced)],
  [Insert image], [Insert image → `assets/logo.svg`], [an `#image("…")` block after the paragraph], [image-upload],
  [Upload, drop, paste], [Upload image…, drop a PNG, paste a screenshot], [added as `image.png`, `image-2.png`, … and inserted], [image-upload],
  [Figures], [`chapters/results.typ` bar chart: Add / Remove caption, Width 50%, drag a corner, Alt text], [one undo step each, editing only its argument], [visual-figures],
  table.cell(colspan: 4)[*Files* (Local / Advanced)],
  [Tree], [expand `chapters`, open `method.typ`], [folders first, `main.typ` marked; expansion kept after reload; images open as a preview], [files-tree, multi-file-ui],
  [Keyboard], [arrows, Home / End, Enter, F2, Delete on a row], [focus moves, folders toggle, open, rename, delete (confirmed)], [files-tree],
  [Changes], [New, New folder `drafts` and a file in it, rename `chapters`, rename `main.typ`], [done (a folder with all its files); the main file protected], [multi-file-ui],
  [Drag & drop], [drag `helpers.typ` onto `chapters`; drop a desktop image on `assets`], [moved; uploaded into the folder], [files-tree],
  [Panel], [Files rail button; drag its edge; window < ~720px], [hides / shows (kept), resizes; narrow: over the editor, closes after a pick], [files-tree],
  [File links], [Source: Mod+click `"template.typ"` (or Alt+Enter); Visual: Open template.typ; write `#include "appendix.typ"`, Create appendix.typ], [opens and selects it in the panel; a missing `.typ` is created], [files-tree],
  [Cross-file jumps], [click chapter text in the preview], [that chapter opens, its folder expands], [multi-file],
  [Previous / next file], [open `chapters/method.typ`], [links to the neighbours in reading order above and below the text], [files-tree],
  [Packages], [`#import "@preview/…"` (needs internet)], [downloaded on first use], [engine unit tests],
  table.cell(colspan: 4)[*Comments*],
  [Margin notes], [select text, Comment (Mod+Alt+M); reply, Resolve], [a card beside the text, in the preview margin; Resolve deletes it], [margin-notes],
  [While collaborating], [Collaborate: comment in one window], [the thread appears in the other], [collab],
  table.cell(colspan: 4)[*Collaboration* (Collaborate / Hello)],
  [Joining], [open Collaborate], [status `Connected to ws://127.0.0.1:1234`], [collab],
  [Two users], [Open a second window as Bob; type in both], [edits converge; each Undo reverts only its own], [collab],
  [Remote cursors], [move the cursor], [a colored caret with the name in the other window], [collab],
  [Files in a room], [Advanced: create or rename a `.typ` file], [the other window follows (images shared only in GitLab rooms)], [collab unit tests],
  [Server missing], [stop the server, reload a Collaborate URL], [status names `mise run demo`, local copy; after a restart it asks for a reload], [demo-playground],
  table.cell(colspan: 4)[*GitLab rooms* (GitLab, fake)],
  [Loading a branch], [open GitLab mode], [`main.typ`, `template.typ`, `helpers.typ`, `chapters`, `assets`; images from the server], [gitlab],
  [Save], [Save to GitLab…, a message, Enter], [both windows: `Saved version <sha> (Ann)`; again: "No changes to save"], [gitlab],
  [Upstream merge], [add `Again.` after `#pagebreak()` in `main.typ`; "add a paragraph", Simulate upstream commit], [both windows: "Merged new changes from GitLab"; your edit kept], [gitlab, `playground.test.ts`],
  [Upstream conflict], [edit the "Introduction" heading; "revise a heading", Simulate], ["Changes on GitLab conflict with edits in …; not saved"; your text kept, no markers], [`gitlab-rooms.test.ts`],
  [Uploads], [upload an image, Save to GitLab…], [part of the commit, shown in the other window], [`gitlab-rooms.test.ts`],
  [Fresh branch], [`?room=gitlab%3Ademo%2Freport%40try-1`], [starts at `main`; saves leave `main` alone], [gitlab],
  table.cell(colspan: 4)[*Embedding*],
  [`<typst-editor>`], [`mise run build:lib`, serve the repository root, open `/examples/plain-html/`], [works, emits `change` events], [web-component],
)

- The playground's logic is unit-tested without a browser or port: `demo/playground*.test.ts`, `demo/server-status.test.ts`, `server/src/playground/playground.test.ts`.

== The docs <architecture-development-docs>

- One Typst project in `docs/`: `main.typ` (the book, and the chapter list `parts`), `site.typ` (one HTML page per chapter), `template.typ`.
- A chapter's label is its path, `/` → `-` (`<architecture-workbench>`); a section appends a word. Cross-references are `@label`.
- Live while writing: `mise run demo`, then `?example=docs`.

== Open work <architecture-development-open-work>

- *Verification*: run every Playwright spec in all three browsers, plus `test:e2e-collab` and `test:e2e-gitlab`; many have never run in a browser. Try a real GitLab.
- *Auth*: GitLab sign-in, a real token check in `onAuthenticate`, the commit author from the verified identity.
- *GitLab rooms*: highlight conflict ranges in the views (the data is sent); report an asset changed on both sides (the room's version wins today); don't commit an empty main file when the repository lacks it.
- *Collaboration*: tell the user when the server is unreachable (the widget stays local silently); share non-`.typ` files outside GitLab rooms; `{ doc }` mode needs the host's Yjs instance, which `dist/lib` does not share.
- *Files*: empty folders live only in the panel; a folder rename, move or delete is one change per file and may stop half-way at a refusal; dragging an image into the Source view does nothing; file links don't follow paths built at run time.
- *Packages*: only `@preview` from packages.typst.org (no `@local`, no other registry); a failed download is retried only after the worker restarts.
- *Visual view*: tables with merged cells, `table.cell`, header arguments or `columns: (..)` stay raw boxes; the toolbar acts on the last main-text selection while the cursor is in a raw box; text typed into a raw box that is modelled Typst stays raw until re-read; a change before the first block re-renders the whole editor; margin-note cards edit raw markup.
- *Preview*: a call whose glyphs come from its definition (`ms(18)`) shows code, not a picture; snippets show only the first page a range is drawn on; raw boxes ask for boxes after every compile, also while the Visual view is hidden.
- *Size*: lazy font loading (a font index up front, data on first use); a smaller wasm needs a Typst fork with feature flags.
- *Inspector*: a right-hand side panel (Notes | Inspector) editing what the Visual view does not show for the selection; contributed sections, a generic fallback for any call's named arguments. Built by hand behind `Layout`; dockview (MIT, +88 KB gzip) can replace its inside once users need to rearrange panels.
- *Custom styles*: swatches in the style menu; a style panel for a `template` function's set and show rules, so the Visual view looks like the document; templates from Typst Universe.
- *Server*: a Rust (`yrs`) or Go server is an open question; the widget depends only on the room protocol.
- *Devtools extension*: a dev-only side panel showing the projection, every contribution by extension and events as they fire, built only on the public API.
