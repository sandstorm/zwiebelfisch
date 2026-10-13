# What features cost (snapshot, 2026-10-13)

Moved from docs/40_architecture/15_development.typ ("What features cost"). Re-measure with `mise run quality:report 100000` and add up per `src/<layer>/<name>/`.

The modules with the most complexity. Lines: TypeScript without blank and comment lines, tests apart. Σ cognitive: summed over the module's functions. Hot: functions with cognitive ≥ 7 or cyclomatic ≥ 8.

| Module | Lines / test | Σ cognitive | Hot | What makes it expensive |
|---|---|---|---|---|
| ext `comments` | 1380 / 1330 | 300 | 19 | its own Typst format for threads; page-margin rewriting (a drafting 0.2.2 workaround); the note card's focus rules |
| host `window` | 1480 / 860 | 228 | 11 | quick input, search everywhere, custom editors with a filename-pattern compiler, messages, status bar |
| host `prosemirror-typst` | 920 / 90 | 198 | 9 | the densest code (parser, serializer, position map), tested almost only through extensions |
| ext `collaboration` | 1070 / 970 | 188 | 6 | every editor, plus a server and GitLab rooms |
| host `visual-editor` | 1460 / 760 | 183 | 5 | raw boxes, toolbar, suggestions, node views: the largest contribution surface |
| ext `devtools` | 870 / 390 | 174 | 7 | document, contributions and events tabs; wraps every extension's context |
| host `workbench` | 1140 / 960 | 135 | 1 | layout, the namespaces, the editors of `*.typ` |
| ext `files` | 710 / 535 | 128 | 6 | its own tree widget and panel |
| host `preview` | 870 / 650 | 120 | 2 | worker, pages, overlays, snippets |
| ext `images` | 740 / 370 | 116 | 1 | image node and resize tools, uploads, the image editor |
