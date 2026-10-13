# Rename to Zwiebelfisch (2026-10-13)

Temporary working note: renaming the product from "Typst editor" to **Zwiebelfisch**
(github.com/sandstorm/zwiebelfisch). Delete it once the steps outside the repository are done.

## Status

- **Done in the repository**: the mapping below, applied by a script (word boundaries, a keep list), files and folders
  moved with `git mv`. Checks green: typecheck, quality, test:unit, server:test, docs (PDF and HTML), check:ci,
  `playwright test --list`.
- **Open**: the user's `mise run test:e2e-all` (the specs use the new element name, test ids and classes); the steps
  outside the repository (development chapter, "Open work"): `git remote add origin
  git@github.com:sandstorm/zwiebelfisch.git`; GitHub settings from `11_development.typ` ("Releasing"); local folder
  `typst-experiment` → `zwiebelfisch` (copy `~/.claude/projects/-Users-sebastian-src-typst-experiment/memory` to the
  new path's folder); local `.env` / `mise.local.toml` with `TYPST_*` variables of ours → `ZWF_*`.

## Rule

"Typst" stays where it means **the language or its compiler**; the **product** gets the new name.

## Mapping

| Old | New |
|---|---|
| npm package `typst-editor`, `dist/lib/typst-editor.js` | `zwiebelfisch` (GitHub Packages: `@sandstorm/zwiebelfisch`), `dist/lib/zwiebelfisch.js` |
| Go module `typst-editor` | `github.com/sandstorm/zwiebelfisch` |
| `server/cmd/typst-server` (binary `typst-server`) | `server/cmd/zwiebelfisch` (binary `zwiebelfisch`) |
| `createTypstEditor`, `TypstEditor`, `TypstEditorOptions`, `TypstEditorChangeDetail` | `createEditor`, `Editor`, `EditorOptions`, `EditorChangeDetail` |
| `TypstEditorElement`, `defineTypstEditorElement` | `EditorElement`, `defineEditorElement` |
| `TypstEditors`, `TypstEditorsOptions`, `#typstEditors` (workbench) | `DocumentEditors`, `DocumentEditorsOptions`, `#documentEditors` |
| `TypstExtension` | `Extension` |
| `src/typst-editor/typst-editor*.{ts,css}` | `src/editor/editor*.{ts,css}` |
| `src/typst-editor-element/typst-editor-element*.ts` | `src/editor-element/editor-element*.ts` |
| `src/hosts/workbench/typst-editors/typst-editors*.ts` | `src/hosts/workbench/document-editors/document-editors*.ts` |
| `<typst-editor>` | `<zwiebelfisch-editor>` |
| our env vars `TYPST_*` (`PLAIN_ROOMS`, `GITLAB_*`, `AUTH_*`, `COLLAB_DB`, `LOG_*`, `ADDRESS`, `DEMO_DIST`, `GITLAB_E2E`, `COLLAB_E2E`, `DOCS_E2E`, `PERF`, `PERF_SCENARIO`) | `ZWF_*` |
| CSS classes, keyframes and `data-testid`s `typst-…` (`typst-visual__…`, `typst-preview`, `typst-status`, `typst-pdf`, …) | `zwf-…` |
| CSS custom properties `--te-*` (theme tokens), `--typst-*` | `--zwf-*` |
| `data-typst-pseudo`, `application/x-typst-project-path` | `data-zwf-pseudo`, `application/x-zwf-project-path` |
| storage keys `typst-editor:…` | `zwf:…` |
| cookies `typst_session`, `typst_login` | `zwf_session`, `zwf_login` |
| ProseMirror plugin keys `typst-highlights`, `typst-presence`; meta `typst-from-document`; style ids `typst-editor-styles`, `typst-ironcalc-styles`; side-bar ids `typst-panel-…` | `zwf-…` |
| the preview's view entry `/.typst-preview-view.typ` | `/.zwf-preview-view.typ` |
| fake GitLab OAuth client id `typst-editor`; default author e-mail `typst-editor@localhost` | `zwiebelfisch`, `zwiebelfisch@localhost` |
| Docker image tag `typst-editor-demo`, docs PDF `typst-editor.pdf`, Playwright host `typst-editor.test` | `zwiebelfisch-demo`, `zwiebelfisch.pdf`, `zwiebelfisch.test` |
| prose: docs/README/`<title>`s/image labels "Typst editor", server answer "Typst editor collaboration server", commit author "Typst editor", default commit message "Edit via Typst editor" | "Zwiebelfisch", "Zwiebelfisch collaboration server", "Zwiebelfisch", "Edit via Zwiebelfisch" |

## Judgement calls

- `TypstEditors` → `DocumentEditors` (not `Editors`): it makes and keeps the `DocumentEditor` of each document; `Editor`
  is the widget's handle now.
- `--te-*` theme tokens ("te" = Typst editor) → `--zwf-*`, like the class prefix; they are public (custom styles).
- Clashes the new names made: the demo's local `EditorOptions` type is `PlaygroundOptions`; Tiptap's `Extension` is
  imported as `TiptapExtension` (slash-commands, word-processors), Tiptap's `Editor` as `TiptapEditor`
  (`editor.clipboard.test.ts`).
- Kept as the language: `data-typst-element` (written by the engine crate), `data-typst-align`, `data-typst-style`
  (Typst's `align` / styles in the Visual editor), `application/x-typst-snippet` and `application/x-typst-imports`
  (Typst source on the clipboard), the Cache Storage name `typst-packages`, the extension id `typst-language`,
  `TYPST_HELP`, `TYPST_SNIPPET_TYPE`, `TYPST_ONLY`, `TYPST_LANGUAGES`, `TYPST_CODE` (constants about Typst source),
  `TypstPasteEditProvider`, `class="typst-doc"` (Typst's own SVG output), "a/the Typst editor(s)" in comments and
  docs where it means the Visual or Source editor of a `.typ` file.
- Prose: "Zwiebelfisch is a Typst editor for the browser" in README and Getting started (the product, then what it
  is); the package description likewise.
- Dated notes (`docs/2026_*.md`) got the current names where they describe today's code; history stays (the gone
  `TYPST_COLLAB_TOKEN`).
