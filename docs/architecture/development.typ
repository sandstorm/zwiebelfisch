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
- The playground's logic is unit-tested without a browser or port: `demo/playground*.test.ts`, `demo/server-status.test.ts`, `server/src/playground/playground.test.ts`.

== The docs <architecture-development-docs>

- One Typst project in `docs/`: `main.typ` (the book, and the chapter list `parts`), `site.typ` (one HTML page per chapter), `template.typ`.
- A chapter's label is its path, `/` → `-` (`<architecture-workbench>`); a section appends a word. Cross-references are `@label`.
- Live while writing: `mise run demo`, then `?example=docs`.

== Devtools <architecture-development-devtools>

`demo/devtools/`: a side panel ("Devtools" on the rail) showing what the widget is made of while it runs. The demo adds it with `?devtools` (the playground bar's Devtools toggle); not in the library, not a built-in.

#table(
  columns: (auto, 1fr),
  table.header[Tab][Shows],
  [Document], [The shown file's ProseMirror document as a tree (@architecture-prosemirror-typst): each node with its source range, `box` for raw boxes and other atoms, marks, its text or kept `src`; the tooltip has positions, attributes and the source. The path to the selection is highlighted; a click selects the node's source.],
  [Contributions], [By extension, in activation order: every `register…` call (`visualView.registerNode · heading`, `commands.registerCommand · files.newFile`) and the declared settings (`contributes.configuration`).],
  [Events], [Every `onDid…` event of the extension context as it fires, with its value in one line; the latest 300.],
)

- *Public API only* (`src/index.ts`): it sees what any outside extension sees.
- *Contributions* are recorded by wrapping the list: `devtools(extensions)` returns each extension with its `activate` getting a context whose namespaces are recording proxies, plus the devtools extension itself. No listing in the hosts.
- *Document*: a Tiptap extension in every Visual view (`registerTiptapExtension`) keeps the view's editor; ranges come from the view's `posToSource`.

```ts
createTypstEditor(host, { extensions: (builtins) => devtools(builtins) });
```

== Open work <architecture-development-open-work>

- *Verification*: run every Playwright spec in all three browsers, plus `test:e2e-collab` and `test:e2e-gitlab`; many have never run in a browser. Try a real GitLab.
- *Auth*: GitLab sign-in, a real token check in `onAuthenticate`, the commit author from the verified identity.
- *GitLab rooms*: highlight conflict ranges in the views (the data is sent); report an asset changed on both sides (the room's version wins today); don't commit an empty main file when the repository lacks it.
- *Collaboration*: tell the user when the server is unreachable (the widget stays local silently); share non-`.typ` files outside GitLab rooms; `{ doc }` mode needs the host's Yjs instance, which `dist/lib` does not share.
- *Files*: empty folders live only in the panel; a folder rename, move or delete is one change per file and may stop half-way at a refusal; dragging an image into the Source view does nothing; file links don't follow paths built at run time.
- *Packages*: only `@preview` from packages.typst.org (no `@local`, no other registry); a failed download is retried only after the worker restarts.
- *Visual view*: tables with merged cells, `table.cell`, header arguments or `columns: (..)` stay raw boxes; the toolbar acts on the last main-text selection while the cursor is in a raw box; text typed into a raw box that is modelled Typst stays raw until re-read; a change before the first block re-renders the whole editor; margin-note cards edit raw markup.
- *Preview*: a call whose glyphs come from its definition (`ms(18)`) shows code, not a picture; snippets show only the first page a range is drawn on; raw boxes ask for boxes after every compile, also while the Visual view is hidden.
- *Size*: a smaller wasm needs a Typst fork with feature flags.
- *Custom styles*: swatches in the style menu; a style panel for a `template` function's set and show rules, so the Visual view looks like the document; templates from Typst Universe.
- *Server*: a Rust (`yrs`) or Go server is an open question; the widget depends only on the room protocol.
