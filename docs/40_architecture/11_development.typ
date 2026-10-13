= Development <architecture-development>

Every operation is a mise task in `mise-tasks/`; tools are pinned to exact versions in `mise.toml` and `package.json`.

== Setup <architecture-development-setup>

Install #link("https://mise.jdx.dev")[mise]. It brings every other tool: Node, pnpm, the Typst CLI, Rust with the `wasm32` target, wasm-bindgen and binaryen. Then run:

```sh
mise install            # the pinned tools
mise run install        # JS dependencies and Playwright browsers
mise run demo           # builds the engine and fonts, then starts the demo
```

The demo (@getting-started-demo) runs on `http://127.0.0.1:5199/`, the collaboration server with a fake GitLab on `ws://127.0.0.1:1234`. Ctrl-C stops both. Unlike the Docker image, it saves edits of the Documentation example to `docs/` (@architecture-development-writing-docs).

== Tasks <architecture-development-tasks>

`mise tasks ls` lists every task with its description. The ones a newcomer needs first:

#table(
  columns: (auto, 1fr),
  table.header[Task][What it does],
  [`deps:lock`], [after a `package.json` change: install and update `pnpm-lock.yaml`],
  [`build:engine`], [Rust → wasm; skipped when the Rust sources are unchanged],
  [`test:e2e`], [Playwright in chromium, firefox and webkit, or one (`test:e2e chromium`); `test:e2e-all` runs every suite],
  [`server:dev`], [the collaboration server (Go) with SQLite in `server/.data/`; GitLab rooms need `TYPST_GITLAB_URL` and `TYPST_GITLAB_TOKEN` (@architecture-server)],
  [`docs:pdf`], [this book → `dist/docs/typst-editor.pdf`],
)

== Checks before a commit <architecture-development-checks>

```sh
mise run typecheck
mise run quality       # ESLint, quality:top-comments, quality:module-cycles
mise run test:unit
mise run server:test   # when server/ or core/room-protocol changed
```

- *Lint limits*: cognitive complexity 12, cyclomatic 10, nesting depth 3, 60 lines per function (tests exempt), 4 parameters. `mise run quality:report` ranks every function.
- *Boundaries and layers* (@architecture-conventions): ESLint rules in `eslint-rules/`. Exceptions are listed in `eslint.config.js` with their reason.
- *Stylesheets*: `src/stylesheets.test.ts` checks that every `.css` parses, has no nested rules and uses hex colors only in token definitions.

== Tests <architecture-development-tests>

- *Unit* (vitest, `*.test.ts` next to the code) run in node. DOM tests opt in with `// @vitest-environment jsdom`.
- *End-to-end* (Playwright, `tests/e2e/*.spec.ts`) run against `dist/demo` and `dist/lib` through request interception, so no port is opened. A slow connection is a route that holds requests back (`slow-connection.spec.ts`).
- *Test packages* (`greet`, `drafting`, `cheq`) sit next to the tests that use them.
- *Agents in the sandbox* cannot launch a browser or bind ports. They write Playwright specs; the user runs them.

== Performance <architecture-development-performance>

`mise run perf:typing` types into the whole widget with the real engine, in jsdom (a paragraph, a list item and a table cell, in the advanced example and in these docs), and prints per keystroke: *sync* (what the keystroke itself blocks), *main thread* (by module and function), *engine* (the worker's work, counted apart) and *layout reads* by caller (free in jsdom, a forced layout in a browser).

- The profiles land in `.cache/perf/*.cpuprofile`; Chrome DevTools opens them.
- jsdom does not measure style, layout and paint: record typing in DevTools' Performance panel and look at the long tasks after a keystroke and after a compile.

== The docs <architecture-development-docs>

The docs are one Typst project in `docs/`: `main.typ` (the book, one `#include` per chapter), `site.typ` (one HTML page per chapter) and `template.typ` (helpers).

- *Parts*: `10_getting-started/`, `20_features/` (for users), `30_configuration/` (for technical users), `40_architecture/` (for developers of the editor). One chapter is one file, numbered in reading order.
- *Style*: the model is `20_features/01`–`04`. Start with one sentence, or a screenshot and then that sentence. Name sections after the sub-feature or task. Speak to the reader ("Type `/`…"), keep sentences short, compare with tools the reader knows. Leave out "Why" and settings; settings go to the configuration part.
- *Labels*: a chapter's label is its path without the numbers, `/` → `-` (`<architecture-workbench>`). A section gets a label only when something refers to it. Cross-references are `@label`.
- *Font*: Gabarito (`fonts/`, SIL Open Font License), a project font for the editor and `--font-path docs/fonts` for `docs:pdf` / `docs:html`.
- *Diagrams*: Mermaid files in `diagrams/`, drawn by merman: `#figure(mermaid(read("../diagrams/x.mmd"), width: 80%), caption: […])`.

*Examples* show a Typst snippet and below it what Typst makes of it, compiled with the book. The Visual editor offers `example` in the text style menu. Each example is evaluated alone, so the reader can copy it into an empty file. A `#set page(..)` shows its pages side by side.

````typ
#example[```typ
#set text(fill: red) // explain the code in comments
Hello TYPST
```]
````

*Screenshots*: `#screenshot("files")` shows `assets/screenshots/files.png`, named after the feature it shows. Show only the element (a panel, a popup, a box with its toolbar) with a little room around it, never the whole window. Use one only where the text or an example cannot show it.

- `mise run docs:screenshots` takes them all, one Playwright test per picture in `tests/screenshots/features.spec.ts`, and lists them in `assets/screenshots/index.typ`; a name not listed shows "Screenshot pending".
- A changed feature: adjust its test, run `docs:screenshots -- --grep <name>`, look at the picture, commit it.

== Writing the docs in the demo <architecture-development-writing-docs>

On `mise run demo` and `mise run demo:build`, the Documentation example (`?example=docs`) edits the files in `docs/` of the checkout: write, watch the preview, commit.

- *Saving*: an edit is written once typing pauses. A create, rename, delete or upload in the file panel happens on disk first. The playground bar says "Saving…", "Saved to …", or why not.
- *Changes on disk* (a checkout, another editor) show up without a reload; unsaved edits in the editor are kept and the next edit saves over the disk.
- *No lost writes*: each write names the version it replaces (`If-Match`), and the server refuses it (412, "Not saved") when the file on disk is another.
- *A static build* has no file API: edits stay in the page, and the bar says so.

Depth (path guard, token, protocol): `docsFiles` in `demo/docs-files/plugin.ts`.

== What features cost <architecture-development-costs>

The modules with the most complexity: a snapshot is in `docs/2026_10_13_feature-costs.md`.

- *To re-measure*: `mise run quality:report 100000` lists every function; add up per `src/<layer>/<name>/`.
- *Candidates to simplify*: page-margin rewriting in `comments`; own tests for `hosts/prosemirror-typst`; thin tests for `figures`, `markup`, `preview-sync`, `outline`; contribution points with one user (`registerPdfExportOption`, `registerEditorFrame`); `diagrams` and `spreadsheets` as extensions a host adds, like collaboration.

== Open work <architecture-development-open-work>

- *Verification*: run every Playwright spec in all three browsers (`test:e2e-all`); many have never run in a browser. Try a real GitLab. Check by eye: IronCalc's dark palette, the diagrams.net embed parameters (`noSaveBtn`, `saveAndExit=0`, `dark=1`) and its export reply.
- *Auth*: GitLab sign-in, a real check as `collab.Authenticate`, the co-authors from the verified identity.
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
- *Find in files*: should the Source editor stop recording other origins' changes in its undo (its ⌘Z also takes back a replace)? Panel keys ⌥⌘C / ⌥⌘W / ⌥⌘R, F4; `filesToInclude`; the scope is not remembered; the quick-open tooltip doesn't name ⌘P.
- *Custom styles*: swatches in the style menu; a style panel for a `template` function's set and show rules; templates from Typst Universe.
- *Text diagrams*: Mermaid only. D2 is not supported (`@preview/tiago` is too experimental); if needed, a converter with `@terrastruct/d2` writing `name.d2.gen.svg`.
- *Diagnostics*: Typst only. Other file kinds would get VS Code's `languages.createDiagnosticCollection`.
- *Server* (Go, `docs/2026_10_13_go-server.md`): run what needs a port where one can be bound, never run against the Go server yet: `TestServerBinary`, `TestPlaygroundBinary`, `test:e2e-collab`, `test:e2e-gitlab`, the Docker image. Then: a server image (`typst-server`; today's image is the playground); read the config YAML file (env only today); expire stale presence (Hocuspocus drops it after 30 s); a file watcher for `server:dev` (watchexec, pinned); rename the module path `typst-editor` once the GitHub remote exists.

== Releasing <architecture-development-release>

GitHub runs the same mise tasks as a checkout (`.github/workflows/`; the tools come from `mise.toml` through `jdx/mise-action`). Every push and pull request runs CI: `typecheck`, `quality`, `test:unit`, `server:test`, `check:examples`, the docs, and `test:e2e chromium` in a job of its own (its `test-results/` are kept when it fails). A pull request builds the Docker image without pushing it. `mise run check:ci` lints the workflows and the `Dockerfile`.

Every push to `main` publishes the site, `https://<owner>.github.io/<repo>/`: the HTML docs, the PDF and the demo under `demo/`. The demo there has no server: Local mode works, GitLab and Collaborate do not.

A release is a version tag: `git tag v1.2.3 && git push origin v1.2.3`. The tag first runs all of CI, end-to-end tests included (`release.yml` calls `ci.yml`); only when it passes does it publish, all on GitHub:

- *Image*: `ghcr.io/<owner>/<repo>:1.2.3` (also `1.2` and `latest`), linux/amd64 and linux/arm64. Every push to `main` updates `:main`. It is the playground image (the Go server with the fake GitLab, distroless) for now.
- *npm package*: `@<owner>/typst-editor@1.2.3` (`dist/lib`) on GitHub's npm registry. `package.json` stays `private` and unscoped; the release workflow sets name, version and registry in its own checkout only.
- *Release*: generated notes, the book as PDF and the package's tarball.

A tag with a pre-release part (`v1.2.3-rc.1`) makes a pre-release, npm dist-tag `next`.
