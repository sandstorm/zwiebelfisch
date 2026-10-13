# Session handover (2026-10-13, branch task/api-extensibility)

Temporary working note for the next session. Delete when its items are done or moved into
`docs/40_architecture/11_development.typ` ("Open work").

State at writing: HEAD `e4f7c1bf` (+ this note and the two concept notes), all unit checks green: typecheck,
2053 unit tests (`vitest src`), 116 demo tests (`vitest demo`), docs compile. Not run today: E2E (Playwright).

## Built today (on the branch)

| Area | What | Commits |
|---|---|---|
| Images | Floating image bar: Caption (input box), Label, 25/50/75/100 %; no "Edit code"/"Alt text"/"Image: path" heading; caption → auto label `fig:<slug>`; deleting an image deletes its figure; uploads go to the folder with most images, else `/images/` (paste, picker, desktop drops via `provideUploadFolder`); SVG without size gets a width | 8cdcba68 |
| Editor | Popup placed below the clicked button inside the editor; Visual ↔ Source switch keeps the selection | 8cdcba68 |
| Removed | Spell checking (extension, setting, docs) | a78ac470 |
| Visual editor | Drag handle (grip on hover, every top-level block + list items) | c3e7e340 |
| | Copy inside a code block without fences | 613c9f84 |
| | Gap cursor CSS, then block gaps (CKEditor-like caret before/after boxes, code blocks too, lists are not boxes) | b03fb17a, be85773c, 93cfb757, f462696e |
| | Tab / Shift+Tab indent in Source, text files, code blocks | 4fc8e314 |
| Find in files | Panel (magnifier), Find/Replace modes, scopes, highlights, Undo; keys mechanism (exact modifiers, `contributes.keybindings`, `workbench.view.<id>`, ⌘P/⌘⇧O/⌘⇧A, ⌃1/⌃3); results wrapped to 3 rows | 9366289d, 34b81d3b |
| Paste | Code-only HTML pastes as Typst; VS Code language → code block; "Paste as: Typst ▾" chip (floating bar / CodeMirror tooltip); paste providers in VS Code's shape; Markdown converter; Word/Google Docs cleanup; "Plain text" always offered | fd5e095d, c0987227 |
| Main file | `Project.setMain`, "Set as main file" (file panel), `mainFile: { path, locked }` option, shared in rooms | 401fb1cd |
| Embedding API | Events on the handle (`onDidChangeFiles`, `onDidChangeMainFile`, `onDidChangeActiveFile`) instead of option callbacks; `editor.updateSettings(partial)` merges (setter gone); options chapter: content / settings / wiring | 0543f5c1, 92639a9a |
| Link hints | A scroll keeps the hover while the link is under the pointer (draw.io screenshot timing) | 457a81b3 |
| Docs | All chapters restyled after the user's 01–04; Find in files chapter 11; draw.io, spreadsheet, Mermaid chapters with `#example` (files in `docs/diagrams/`, `docs/data/`) | dc91bf6f, f4bcf4d7, 5bc5eb1f, ddb602ac |

## Waiting for the user

- **GitLab projects** (`docs/2026_10_13_gitlab-projects.md`): chooser after OAuth (IntelliJ-like, recents, open from a pasted GitLab URL). Open questions there: branch part of the project? recents on server or browser? `api` scope vs service token? auto-commit after everyone left? one or several GitLab instances?
- **Go server** (`docs/2026_10_13_go-server.md`): decided Go + Yjs via `reearth/ygo`, no fallback; server compile via wazero, module at the repo root, zerolog. No open questions left.
- **Find in files**: should the Source editor stop recording other origins' changes in its undo (⌘Z there also undoes a replace)?
- **Paste**: a paste provider that throws drops the whole paste silently — harden?
- **Docs**: merge draw.io + Mermaid into one "Diagrams" chapter? `docs/diagrams/comment-card.mmd` unused — delete? The `tables` screenshot has no spec.
- **Worktrees**: ~148 under `.claude/worktrees` (all branches merged or obsolete) — remove after a listing.

## To try / run

- By hand in the browser (Chrome, Firefox, Safari): drag handle, block gaps (two `#example`s, code blocks, lists, tables), Tab indent, code-block copy, Find in files (keys ⌘P/⌘⇧A not hijacked by the browser, ⌃1/⌃3, Replace all + Undo, narrow panel rows), paste sources (GitHub, Typst docs, VS Code Python, chat Markdown, Word/Google Docs, ⌘⇧V, chip switching + one ⌘Z), "Set as main file", image bar.
- `mise run build:packages`, then `mise run test:e2e-all chromium` (updated specs: visual-figures, visual-links-tables, find-in-files, devtools).
- `mise run docs:screenshots` (images, find-in-files, drawio-diagrams after 457a81b3).

## Working rules learned today

- Subagent briefs must say that relayed user messages are addressed to the main agent and are never the subagent's task; sequential step workflows stop when a step returns without a commit (one leaked "status" request once burned five steps).
- The user edits docs live: apply subagent commits with `git cherry-pick` / `git apply` excluding the user's uncommitted files; stage by name; checks before committing.
- `#example` code runs relative to `docs/` (it is evaluated in `template.typ`): files it reads go in `docs/…`.
