= Development <architecture-development>

Every operation is a mise task (`mise-tasks/`, `mise tasks ls`). Tools are pinned to exact versions in `mise.toml` and `package.json`.

== Tasks <architecture-development-tasks>

#table(
  columns: (auto, 1fr),
  table.header[Task][What it does],
  [`install`], [JS dependencies (frozen lockfile) and Playwright's browsers],
  [`deps:lock`], [after a `package.json` change: install and update `pnpm-lock.yaml`],
  [`dev`], [Vite dev server for `demo/` on 127.0.0.1:5199 (Local mode needs nothing else); builds engine and fonts first],
  [`demo`], [the playground: Vite + the collaboration server with a fake GitLab on `ws://127.0.0.1:1234` (@guide-getting-started-demo); builds engine and fonts first],
  [`build:engine`], [Rust → wasm (`cargo`, `wasm-bindgen`, `wasm-opt -Oz`) into `src/core/typst-engine/wasm/`; skipped when the Rust sources are unchanged],
  [`build:fonts`], [the default fonts of the pinned typst-assets crate into `src/core/typst-engine/fonts/`, and their index `index.json` (@architecture-core-engine-fonts)],
  [`build:packages`], [the `@preview/…` packages the demo examples import, downloaded once into `.cache/typst-packages/` (not committed); `test:unit` runs it],
  [`build`], [typecheck, engine, fonts, library, then the static demo → `dist/demo`],
  [`build:lib`], [the library → `dist/lib`: ESM, worker, wasm, fonts (content-hashed names), d.ts],
  [`typecheck`], [`tsc` over the widget, demo, tests and server],
  [`quality`], [ESLint (complexity, module boundaries, layers), `quality:top-comments`, `quality:module-cycles`],
  [`quality:report`], [every function ranked by complexity (hot spots)],
  [`test:unit`], [vitest over `src/`, `demo/`, `eslint-rules/`; the engine runs as real wasm],
  [`server:test`], [the server's vitest suite, Hocuspocus in-process, no port],
  [`test:e2e`], [builds demo and library, then Playwright in chromium, firefox, webkit (or one: `test:e2e chromium`)],
  [`test:e2e-collab`], [in-memory server + the two-user spec (`tests/e2e/collab.spec.ts`)],
  [`test:e2e-docs`], [the Vite dev server + the docs-editing spec (`tests/e2e/docs-editing.spec.ts`): edits a heading in the Documentation example, checks the file in `docs/`, restores it],
  [`test:e2e-gitlab`], [fake-GitLab server + the GitLab room spec (`tests/e2e/gitlab.spec.ts`); a failed save (the playground's GitLab outage), the leave warning while a conflict blocks the commit; with `TYPST_GITLAB_AUTO_COMMIT=off` also the leave warning without one],
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
- *End-to-end* (Playwright, `tests/e2e/*.spec.ts`): against the static build `dist/demo` and `examples/` (+ `dist/lib`), served through request interception, so no port is opened. A slow connection is a route that holds requests back until the test releases them (`tests/e2e/slow-connection.spec.ts`: the wasm, fonts, a package).
- Test packages (`greet`, `drafting`, `cheq`) sit next to the tests using them.
- Agents in the sandbox cannot launch a browser or bind ports: they write Playwright specs, and the user runs `mise run test:e2e`.
- The playground's logic is unit-tested without a browser or port: `demo/playground*.test.ts`, `demo/server-status.test.ts`, `server/src/playground/playground.test.ts`.

== The docs <architecture-development-docs>

- One Typst project in `docs/`: `main.typ` (the book: each part's `=` heading, then one `#include` per chapter, in reading order), `site.typ` (one HTML page per chapter, read from `main.typ`'s includes), `template.typ`. Parts and chapters are numbered so the files sort in reading order: `10_guide/02_features.typ`.
- A chapter's label is its path without the numbers, `/` → `-` (`<architecture-workbench>`); a section appends a word. Cross-references are `@label`.
- The font, Gabarito (SIL Open Font License, `fonts/OFL.txt`), is in `fonts/`: a project font for the editor (@architecture-core-engine-fonts), `--font-path docs/fonts` for `docs:pdf` / `docs:html`.
- Diagrams are Mermaid files in `diagrams/`, drawn by merman in the docs' colors: `#figure(mermaid(read("../diagrams/x.mmd"), width: 80%), caption: […])` with `mermaid` from `template.typ`.
- Live while writing: `mise run demo` (or `mise run dev`), then `?example=docs` (@architecture-development-writing-docs).

== Writing the docs in the demo <architecture-development-writing-docs>

On the dev server the Documentation example edits the files in `docs/` of the checkout, so the demo is the editor for this book: write, watch the preview, commit.

- *Saving*: an edit is written once the typing pauses (300 ms per file; at once when the page is hidden). A create, rename, delete or image upload in the file panel happens on disk first, and the editor refuses it if the disk did. The end of the playground bar says what happened: "Saving…", "Saved to docs/10_guide/02_features.typ", or why not.
- *Changes on disk* (a checkout, another editor) show up in the editor without a reload. A file with unsaved edits in the editor keeps them; the bar says so, and the next edit saves over the disk's version.
- *What it may touch*: files under `docs/`, by relative path: no `..`, no hidden files, no symlinks. Only the dev server's own page may write: its origin, with a token the server puts into the page at each start.
- *A static build* (`mise run build`, the e2e build) has no file API: edits stay in the page, and the bar says so.
- The code, in `demo/docs-files/`: `plugin.ts` (the Vite plugin, dev server only: the endpoint `/__docs-files`, and the watcher's events for `docs/` as an HMR event instead of a reload), `docs-folder.ts` (the path guard, atomic writes), `docs-sync.ts` (the page: debounced writes, changes from disk, the conflict rule). A file travels as text or bytes by its extension.

== Open work <architecture-development-open-work>

- *Verification*: run every Playwright spec in all three browsers, plus `test:e2e-collab` and `test:e2e-gitlab`; many have never run in a browser. Try a real GitLab.
- *Auth*: GitLab sign-in, a real token check in `onAuthenticate`, the commit author from the verified identity.
- *GitLab rooms*: highlight conflict ranges in the views (the data is sent); report an asset changed on both sides (the room's version wins today); don't commit an empty main file when the repository lacks it.
- *Collaboration*: tell the user when the server is unreachable (the editing area stays at "Connecting to the room…"; a host that probes first, as the demo, falls back to local); share non-`.typ` files outside GitLab rooms; `{ doc }` mode needs the host's Yjs instance, which `dist/lib` does not share.
- *Files*: empty folders live only in the panel; a folder rename, move or delete is one change per file and may stop half-way at a refusal; dragging an image into the Source view does nothing; file links don't follow paths built at run time.
- *Packages*: only `@preview` from packages.typst.org (no `@local`, no other registry); a failed download is retried only after the worker restarts.
- *Visual view*: tables with merged cells, `table.cell`, header arguments or a computed `columns` stay raw boxes; the toolbar acts on the last main-text selection while the cursor is in a raw box; text typed into a raw box that is modelled Typst stays raw until re-read; a change before the first block re-renders the whole editor; margin-note cards edit raw markup. Undo after "Insert spreadsheet" / "Insert Mermaid diagram" takes back the figure, not the import it added.
- *Preview*: a call whose glyphs come from its definition (`ms(18)`, a helper or package function outside an element such as `figure`) shows code, not a picture: the frame holds only the definition's spans and no tag of the call; snippets show only the first page a range is drawn on; raw boxes ask for boxes after every compile, also while the Visual view is hidden.
- *Size*: a smaller wasm needs a Typst fork with feature flags.
- *Custom styles*: swatches in the style menu; a style panel for a `template` function's set and show rules, so the Visual view looks like the document; templates from Typst Universe.
- *Server*: a Rust (`yrs`) or Go server is an open question; the widget depends only on the room protocol.
