# Follow-ups collected from the first build round (2026-10-10)

Status: open — split into separate task files when picked up.
Each line names the area; sources are the agents' final reports.

## Verification (highest priority)
- Browser runs of all Playwright specs (`test:e2e` in chromium/firefox/webkit, `test:e2e-collab`,
  `test:e2e-gitlab`); fix whatever they find. Many specs have never run in a browser.
- Try against a real GitLab (`TYPST_GITLAB_URL`, `TYPST_GITLAB_TOKEN` in `mise.local.toml`).

## Auth & server
- Real authentication: GitLab OAuth sign-in, token check in `onAuthenticate`, commit author from
  the verified identity (today: stub + client-provided name).
- Repository without the widget's `main` file: don't commit an empty main file.
- Binary files changed both in the room and upstream: room version silently wins — detect and report.
- Conflict reports: highlight the conflicting ranges in both views (data is already sent).
- Unreachable collab server: tell the user (today the widget silently stays local).

## Editor
- "Show changes" only covers the main file → per file. (Comments are margin notes in the text
  now, so they already work in every `.typ` file.)
- Toolbar acts on the last main-text selection while the cursor is in a raw box.
- Text typed into a raw box that is modelled Typst (`= Heading`) stays raw until re-read.
- "Insert into …" (image) uses the Source-view cursor; use the active view's cursor.
- Margin notes (comments): the Visual-view note card edits raw Typst markup, not formatted text;
  Escape on a brand-new note leaves an empty `#margin-note[]`; a note that only becomes valid
  by escaping is saved as escaped plain text (its formatting is lost). (Anchors and editing
  after posting no longer apply: notes are text in the source.)
- Visual view: a change to the text before the first block (`doc.lead`) still rebuilds the whole
  editor DOM (ProseMirror re-renders on any doc attribute change). (Open note cards are outside
  the editor DOM since the notes gutter, so they survive it.)
- Remote cursors on empty lines are not drawn.
- Source-view diff chunks lack the word/markup cleanup the other views get.

## Preview / performance
- Raw boxes re-request boxes after every compile, even while the Visual view is hidden.
- Diff runs twice per keystroke while changes are shown; cache the base's syntax tree.
- Snippets show only the first page a range is drawn on.
- Fit-width no longer caps page width on wide panes.
- wasm is 21 MB (8 MB gzip): only a typst fork with feature flags can shrink it further;
  lazy font loading (font index + fetch on use) is still open.

## Packaging
- `{ doc }` collaboration mode needs a shared Yjs instance; `dist/lib` bundles its own.
- `fixtures:packages` uses the unpinned system `tar`.
