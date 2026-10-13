# Rename to Zwiebelfisch (2026-10-13)

Temporary working note: the plan for renaming the product from "Typst editor" to **Zwiebelfisch**
(github.com/sandstorm/zwiebelfisch). Run it once the open workflows are merged, as one mechanical commit per step;
then delete this note.

## Rule

"Typst" stays where it means **the language or its compiler**; the **product** gets the new name.

| Keep (the language) | Rename (the product) |
|---|---|
| `crates/typst-engine`, `TypstEngine`, `TypstEngineCrash`, `src/core/typst-engine` | npm package `typst-editor` → `zwiebelfisch` (GitHub Packages: `@sandstorm/zwiebelfisch`) |
| `prosemirror-typst`, `TypstDocument`, `TypstNodeSpec`, `TypstMarkSpec`, `TypstParseContext`, `TypstSerializeState`, `TypstStyle*`, `TypstDiagnostic`, `TypstConversions` | Go module `typst-editor` → `github.com/sandstorm/zwiebelfisch` |
| `typst.*` language ids (`'typst.code'`, `'typst.html'`, …) | `createTypstEditor` → `createZwiebelfisch`? (see Q1), `TypstEditor`, `TypstEditorOptions`, `TypstEditors`, `TypstEditorElement`, `TypstEditorChangeDetail`, `TypstEditorsOptions` |
| `typst` CLI, `.typ` files, `TYPST_PACKAGE_CACHE_PATH` etc. (Typst's own env vars) | `TypstExtension` → `ZwiebelfischExtension`? or `Extension` (Q2) |
| | web component `<typst-editor>` → `<zwiebel-fisch>` / `<zwiebelfisch-editor>` (Q3) |
| | env vars `TYPST_*` of our server (`TYPST_PLAIN_ROOMS`, `TYPST_GITLAB_*`, `TYPST_AUTH_*`, `TYPST_COLLAB_DB`, `TYPST_LOG_*`, `TYPST_ADDRESS`, `TYPST_DEMO_DIST`) → `ZWIEBELFISCH_*` (Q4). Also avoids clashing with Typst's own `TYPST_*` |
| | storage keys `typst-editor:global:…` (localStorage), cookie names, `server/cmd/typst-server` → `server/cmd/zwiebelfisch` |
| | Docker image `ghcr.io/sandstorm/zwiebelfisch`, Pages `sandstorm.github.io/zwiebelfisch`, docs title "Typst editor" → "Zwiebelfisch", README, `<title>`s, demo header |
| | CSS / `data-testid` prefix `typst-` (`typst-visual`, `typst-preview__page`, 1325 hits in 186 files) → `zf-`? (Q5) |

Size (today): `typst-editor` 556 hits / 131 files; `TypstEditor*` 164 / 37; `createTypstEditor` 80 / 31; `TYPST_` 164 / 42;
`typst-…__` classes 1325 / 186.

## How

1. **Mapping table first** (this note, answered Qs): exact old → new strings, ordered longest first, each with the
   file globs it applies to (TS/CSS/Go/Typst/YAML/mise tasks/Dockerfile/README). Language-meaning names are on a
   deny list so a blind replace cannot touch them (`TypstDocument`, `typst-engine`, `typst.code`, …).
2. **One script** (scratch, not committed) applies the table with word boundaries; `git mv` for files and folders
   whose names carry the product name (`server/cmd/typst-server`, `typst-editor-element.ts`, …).
3. **Checks**: typecheck, quality, test:unit, server:test, docs compile, actionlint; then the user runs
   `mise run test:e2e-all` (the specs use the `data-testid`s and the element name).
4. **Outside the repo**: `git remote add origin git@github.com:sandstorm/zwiebelfisch.git`; GitHub settings from
   `11_development.typ` ("Releasing"); local folder `typst-experiment` → `zwiebelfisch` (moves Claude's memory folder
   too: copy `~/.claude/projects/-Users-sebastian-src-typst-experiment/memory` to the new path's folder).
5. No backwards compatibility: no aliases for the old element name, API name, env vars or storage keys.

## Decided (user, 2026-10-13)

- API entry: `createEditor(host, options)` (types `Editor`, `EditorOptions`, …): the package name says whose.
- Web component: `<zwiebelfisch-editor>`.
- Env prefix and CSS/test-id prefix: open — not `ZF_`/`zf-` (reads as Zend Framework).

## Questions for the user (original)

1. API entry: `createZwiebelfisch(host, options)`, or neutral `createEditor(host, options)` (the package name says
   whose)?
2. `TypstExtension` (109 hits): `ZwiebelfischExtension`, or `Extension` (VS Code's own name for its extension
   object is `Extension`, which could be confusing)?
3. Web component: `<zwiebel-fisch>` (short, needs the hyphen anyway) or `<zwiebelfisch-editor>`?
4. Env prefix: `ZWIEBELFISCH_` (long, unambiguous) or `ZF_`?
5. CSS / test-id prefix: keep `typst-` (it reads as "the Typst part"), or `zf-` (short), or `zwiebelfisch-`?
