= Development <architecture-development>

Every operation is a mise task (`mise-tasks/`, `mise tasks ls`). Tools are pinned to exact versions in `mise.toml` and `package.json`.

== Setup <architecture-development-setup>

Install #link("https://mise.jdx.dev")[mise]. It brings every other tool: Node, pnpm, the Typst CLI, Rust with the `wasm32` target, wasm-bindgen and binaryen. Then run:

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds the engine and fonts, then starts the demo
```

The demo (@getting-started-demo) runs on `http://127.0.0.1:5199/`, the collaboration server with a fake GitLab on `ws://127.0.0.1:1234`. Ctrl-C stops both. Unlike the Docker image, it saves edits of the Documentation example to `docs/` (@architecture-development-writing-docs).

== Tasks <architecture-development-tasks>

#table(
  columns: (auto, 1fr),
  table.header[Task][What it does],
  [`install`], [JS dependencies (frozen lockfile) and Playwright's browsers],
  [`deps:lock`], [after a `package.json` change: install and update `pnpm-lock.yaml`],
  [`demo`], [Vite + the collaboration server with a fake GitLab (@getting-started-demo); arguments go to Vite],
  [`demo:build`], [the same on the production build (`build:demo`, then `vite preview`)],
  [`docker:build`], [the image `typst-editor-demo`; the playground server serves the built demo, no Vite],
  [`docker:run`], [runs the image on 127.0.0.1:5199 and :1234, without saving the Documentation example (@getting-started-docker)],
  [`build:engine`], [Rust → wasm into `src/core/typst-engine/wasm/`; skipped when the Rust sources are unchanged],
  [`build:fonts`], [the default fonts of the pinned typst-assets crate and their `index.json` (@architecture-core-engine-fonts)],
  [`build:packages`], [the `@preview/…` packages the demo examples import, into `.cache/typst-packages/`],
  [`build:demo`], [engine, fonts, then `vite build` → `dist/demo`],
  [`build`], [typecheck, `build:demo`, `build:lib`],
  [`build:lib`], [the library → `dist/lib`: ESM, worker, wasm, fonts, d.ts],
  [`typecheck`], [`tsc` over the widget, demo, tests and server],
  [`quality`], [ESLint (complexity, boundaries, layers, definition order), `quality:top-comments`, `quality:module-cycles`],
  [`quality:report`], [every function ranked by complexity (hot spots)],
  [`test:unit`], [vitest over `src/`, `demo/`, `eslint-rules/`, with the real wasm engine],
  [`server:test`], [the server's vitest suite, Hocuspocus in-process],
  [`perf:typing`], [typing speed in the Visual editor (@architecture-development-performance); `perf:typing docs` runs only the docs scenarios],
  [`test:e2e`], [Playwright in chromium, firefox and webkit, or one (`test:e2e chromium`)],
  [`test:e2e-collab`], [two users on an in-memory server (`tests/e2e/collab.spec.ts`)],
  [`test:e2e-docs`], [editing a docs file on the Vite dev server (`tests/e2e/docs-editing.spec.ts`)],
  [`test:e2e-gitlab`], [GitLab rooms on the fake-GitLab server (`tests/e2e/gitlab.spec.ts`)],
  [`test:e2e-all`], [every e2e suite, also GitLab with `TYPST_GITLAB_AUTO_COMMIT=off`; lists the failed ones at the end],
  [`test:all`], [`test:unit`, `server:test`, `test:e2e-all`],
  [`server:dev`], [the collaboration server with SQLite in `server/.data/` (@architecture-server)],
  [`server:dev-fake-gitlab`], [the playground server alone],
  [`check:examples`], [every demo example compiled with the Typst CLI],
  [`fixtures:packages`], [test packages `src/**/fixtures/<name>-<version>/` packed as `.tar.gz`],
  [`fixtures:demo-spreadsheets`], [the examples' `.ic` spreadsheets with their `.ic.gen.typ`],
  [`fixtures:demo-diagram`], [the simple example's `diagrams/editor.drawio.png`],
  [`docs:pdf`], [this book → `dist/docs/typst-editor.pdf`],
  [`docs:html`], [these pages → `dist/docs/html/`],
  [`docs:screenshots`], [the feature chapters' pictures (@architecture-development-docs); arguments go to Playwright (`-- --grep tables`)],
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

- *Boundaries and layers*: ESLint rules in `eslint-rules/` (`local/entry-imports`, `local/no-re-exports`, `local/dependencies`). Exceptions are listed in `eslint.config.js` with their reason.
- *Stylesheets*: `src/stylesheets.test.ts` checks that every `.css` parses, has no nested rules and uses hex colors only in token definitions.

== Tests <architecture-development-tests>

- *Unit* (vitest, `*.test.ts` next to the code) run in node. DOM tests opt in with `// @vitest-environment jsdom`.
- *End-to-end* (Playwright, `tests/e2e/*.spec.ts`) run against `dist/demo` and `dist/lib` through request interception, so no port is opened. A slow connection is a route that holds requests back (`slow-connection.spec.ts`).
- *Test packages* (`greet`, `drafting`, `cheq`) sit next to the tests that use them.
- *Agents in the sandbox* cannot launch a browser or bind ports. They write Playwright specs; the user runs them.
- *The playground's logic* is unit-tested without a browser: `demo/*.test.ts`, `server/src/playground/playground.test.ts`.

== Performance <architecture-development-performance>

`mise run perf:typing` (`tests/perf/typing.perf.ts`) types into the whole widget with the real engine, in jsdom: a paragraph, a list item and a table cell, in the advanced example and in these docs. Per keystroke it prints:

- *sync*: what the keystroke itself blocks (transaction, write-back, document listeners).
- *main thread*: all main-thread work in that time, by module and function (from a CPU profile).
- *engine*: the worker's work, run in-process and counted apart (`in-process-worker.ts`).
- *layout reads* by caller (`getBoundingClientRect`, …): free in jsdom, a forced layout in a browser.

The profiles land in `.cache/perf/*.cpuprofile`; Chrome DevTools opens them. jsdom does not measure style, layout and paint. For those, record typing in DevTools' Performance panel and look at the long tasks after a keystroke and after a compile.

== The docs <architecture-development-docs>

The docs are one Typst project in `docs/`: `main.typ` (the book, one `#include` per chapter), `site.typ` (one HTML page per chapter) and `template.typ` (helpers).

- *Parts*: `10_getting-started/`, `20_features/` (for users), `30_configuration/` (for technical users), `40_architecture/` (for developers of the editor). One chapter is one file, numbered in reading order.
- *Style*: the model is `20_features/01`–`04`. Start with one sentence, or a screenshot and then that sentence. Name sections after the sub-feature or task. Speak to the reader ("Type `/`…"), keep sentences short, compare with tools the reader knows. Leave out "Why" and settings; settings go to the configuration part.
- *Labels*: a chapter's label is its path without the numbers, `/` → `-` (`<architecture-workbench>`). A section gets a label only when something refers to it. Cross-references are `@label`.
- *Font*: Gabarito (`fonts/`, SIL Open Font License), a project font for the editor and `--font-path docs/fonts` for `docs:pdf` / `docs:html`.
- *Diagrams*: Mermaid files in `diagrams/`, drawn by merman: `#figure(mermaid(read("../diagrams/x.mmd"), width: 80%), caption: […])`.
- *Live while writing*: `mise run demo`, then `?example=docs` (@architecture-development-writing-docs).

*Examples* show a Typst snippet and below it what Typst makes of it, compiled with the book. The Visual editor offers `example` in the text style menu. Each example is evaluated alone, so the reader can copy it into an empty file. A `#set page(..)` shows its pages side by side.

````typ
#example[```typ
#set text(fill: red) // explain the code in comments
Hello TYPST
```]
````

*Screenshots*: `#screenshot("files")` shows `assets/screenshots/files.png`, named after the feature it shows. Show only the element (a panel, a popup, a box with its toolbar) with a little room around it, never the whole window. Use one only where the text or an example cannot show it.

- `mise run docs:screenshots` takes them all: one Playwright test per picture in `tests/screenshots/features.spec.ts`, against the demo build, 1280 × 800, light, without motion.
- The task lists the pictures in `assets/screenshots/index.typ`; a name not listed shows "Screenshot pending".
- A changed feature: adjust its test, run `docs:screenshots -- --grep <name>`, look at the picture, commit it.

== Writing the docs in the demo <architecture-development-writing-docs>

On `mise run demo` and `mise run demo:build`, the Documentation example edits the files in `docs/` of the checkout. The demo is the editor for this book: write, watch the preview, commit.

- *Saving*: an edit is written once typing pauses. A create, rename, delete or upload in the file panel happens on disk first. The playground bar says "Saving…", "Saved to …", or why not.
- *Changes on disk* (a checkout, another editor) show up without a reload. Unsaved edits in the editor are kept, and the next edit saves over the disk.
- *No lost writes*: each write names the version it replaces (`If-Match`), and the server refuses it (412, "Not saved") when the file on disk is another.
- *What it may touch*: files under `docs/` only (no `..`, hidden files or symlinks), and only from the server's own page, with a token it puts into the page.
- *A static build* has no file API: edits stay in the page, and the bar says so.
- *The code* is in `demo/docs-files/`: `plugin.ts` (the Vite plugin, endpoint `/__docs-files` and an event stream), `docs-folder.ts` (path guard, atomic writes, watcher), `docs-sync.ts` (the page's side).

== What features cost <architecture-development-costs>

The modules with the most complexity. Lines: TypeScript without blank and comment lines, tests apart. Σ cognitive: summed over the module's functions. Hot: functions with cognitive ≥ 7 or cyclomatic ≥ 8.

#table(
  columns: (auto, auto, auto, auto, 1fr),
  table.header[Module][Lines / test][Σ cognitive][Hot][What makes it expensive],
  [ext `comments`], [1380 / 1330], [300], [19], [its own Typst format for threads; page-margin rewriting (a drafting 0.2.2 workaround); the note card's focus rules],
  [host `window`], [1480 / 860], [228], [11], [quick input, search everywhere, custom editors with a filename-pattern compiler, messages, status bar],
  [host `prosemirror-typst`], [920 / 90], [198], [9], [the densest code (parser, serializer, position map), tested almost only through extensions],
  [ext `collaboration`], [1070 / 970], [188], [6], [every editor, plus a server and GitLab rooms],
  [host `visual-editor`], [1460 / 760], [183], [5], [raw boxes, toolbar, suggestions, node views: the largest contribution surface],
  [ext `devtools`], [870 / 390], [174], [7], [document, contributions and events tabs; wraps every extension's context],
  [host `workbench`], [1140 / 960], [135], [1], [layout, the namespaces, the editors of `*.typ`],
  [ext `files`], [710 / 535], [128], [6], [its own tree widget and panel],
  [host `preview`], [870 / 650], [120], [2], [worker, pages, overlays, snippets (@architecture-core-engine-size)],
  [ext `images`], [740 / 370], [116], [1], [image node and resize tools, uploads, the image editor],
)

- *To re-measure*: `mise run quality:report 100000` lists every function; add up per `src/<layer>/<name>/`.
- *Candidates to simplify*: page-margin rewriting in `comments`; own tests for `hosts/prosemirror-typst`; thin tests for `figures`, `markup`, `preview-sync`, `outline`; contribution points with one user (`registerPdfExportOption`, `registerEditorFrame`); `diagrams` and `spreadsheets` as extensions a host adds, like collaboration.

== Open work <architecture-development-open-work>

- *Verification*: run every Playwright spec in all three browsers (`test:e2e-all`); many have never run in a browser. Try a real GitLab. Check by eye: IronCalc's dark palette, the diagrams.net embed parameters (`noSaveBtn`, `saveAndExit=0`, `dark=1`) and its export reply.
- *Auth*: GitLab sign-in, a real token check in `onAuthenticate`, the commit author from the verified identity.
- *GitLab rooms*: highlight conflict ranges in the editors (the data is sent); report an asset changed on both sides (the room's wins today); don't commit an empty main file when the repository lacks it.
- *Collaboration*: tell the user when the server is unreachable (it stays at "Connecting to the room…"); share non-`.typ` files outside GitLab rooms; `{ doc }` mode needs the host's Yjs instance, which `dist/lib` does not share.
- *Files*: empty folders live only in the panel; a folder rename, move or delete is one change per file and may stop half-way; file links don't follow paths built at run time; a dropped `.ic` gets no figure until its `.ic.gen.typ` exists; a dropped `.drawio` inserts nothing, a `.drawio.svg` becomes a plain `#image`.
- *Packages*: only `@preview` from packages.typst.org; a failed download is retried only after the worker restarts.
- *Visual editor*: tables with merged cells, `table.cell`, header arguments or computed `columns` stay raw boxes; the toolbar acts on the last main-text selection while the cursor is in a raw box; text typed into a raw box stays raw until re-read; a change before the first block re-renders the whole editor; margin-note cards edit raw markup.
- *Preview*: a call whose glyphs come from its definition (`ms(18)`, a helper outside an element such as `figure`) shows code, not a picture; snippets show only the first page of a range, in the document's colors; raw boxes ask for their boxes after every compile, also when their page did not change.
- *Typing speed* (`perf:typing`):
  - the label and style indexes each parse the edited file on every keystroke (1.5 and 1.2 ms in a docs chapter; one shared parse would do);
  - a raw box's picture is the whole page's SVG with a cropped `viewBox`, built and decoded per box and compile;
  - the engine renders every page's SVG before the worker leaves the known ones out (28 MB of JSON per compile for the docs);
  - in the docs the first and last pages change with every compile.
- *Search everywhere*: a bibliography group (`.bib` keys and titles); recently opened files first; commands listed while registered (no `enablement`); "Save to GitLab…" and "Download PDF" are no declared commands yet; a setting changed there is gone with the page.
- *Custom styles*: swatches in the style menu; a style panel for a `template` function's set and show rules; templates from Typst Universe.
- *Text diagrams*: Mermaid only. D2 is not supported (`@preview/tiago` is too experimental); if needed, a converter with `@terrastruct/d2` writing `name.d2.gen.svg`.
- *Diagnostics*: Typst only. Other file kinds would get VS Code's `languages.createDiagnosticCollection`.
- *Server*: a Rust (`yrs`) or Go server is an open question; the widget depends only on the room protocol.
