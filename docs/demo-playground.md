# Demo playground: feature checklist

Every user-visible feature of the editor can be tried by hand in the demo, on one machine,
without a real GitLab, secrets or network (only localhost). This page explains how to start the
playground and gives the exact steps to check each feature.

## Start

```sh
mise run demo
```

This starts two things, and Ctrl-C stops both:

- the demo (Vite) on <http://127.0.0.1:5199/>;
- the playground collaboration server on `ws://127.0.0.1:1234`
  (`server/src/fake-gitlab-main.ts`, in memory, nothing stored). It serves plain rooms, and
  GitLab rooms `gitlab:demo/report@<any branch>` backed by an in-memory **fake GitLab**. Its
  project `demo/report` holds the advanced example (template, chapters, helper module, SVG
  images).

The script prints the URLs to open. `mise run dev` still starts the demo alone, and Local mode
needs nothing else. `mise run server:dev-fake-gitlab` starts the playground server alone.

## The playground bar

| Control | What it does |
|---|---|
| **Examples**: Hello / Simple / Advanced | Picks the project (`?example=`). Hello is one short file. Simple is one file with lists, math, a link and a table. Advanced has several files: template, chapters, helpers and SVG images. In GitLab mode the repository sets the files, so these links are disabled. |
| **Mode**: Local | Default. Everything runs in the tab and no server is contacted. The static e2e build uses this mode. |
| **Mode**: Collaborate | Joins the room `playground-<example>` on the local server (`?room=`). The first person to join seeds the room with the example. After that, the room's text wins. |
| **Mode**: GitLab (fake) | Joins `gitlab:demo/report@main`: the fake repository's `main` branch. |
| **Name** | The name the others see next to your cursor. It is also the author of comments and commits (`?user=`). Press Enter to apply it. |
| **Track changes** | Local and Collaborate only (`?changes`). Shows changes against the example as it was loaded. GitLab rooms always compare with their last commit. |
| **Open a second window as Bob** | Opens the same room as another user (Ann → Bob → Cleo → Dan) in a new window, so one person can try collaboration. |
| **Upstream change** + **Simulate upstream commit** | GitLab mode only. The fake GitLab commits a change to the room's branch, as a colleague pushing would. It then delivers GitLab's push webhook, so the room merges the change at once. "add a paragraph" appends to `chapters/introduction.typ`; "revise a heading" changes that file's first heading, which you can use to provoke a conflict. |
| status | Shows whether the server is reachable. If it is not, the status gives the command to start it and the page edits a local copy of the example instead of waiting. If the server comes up later, the status asks for a reload. |

Every state has a URL, so links can be shared between windows. For example:
`/?example=advanced&room=playground-advanced&user=Bob`,
`/?room=gitlab%3Ademo%2Freport%40my-branch&user=Ann` (a fresh branch, which starts at `main`).

Tip: the fake repository lives in memory. Restart `mise run demo` to reset it, or use a fresh
branch name.

## Checklist

Each item names the mode and example to use, the steps to take and what you should see. The
"Automated" column names the spec that also covers the item. Specs under `tests/e2e` run with
`mise run test:e2e`, except `collab.spec.ts` (`mise run test:e2e-collab`) and `gitlab.spec.ts`
(`mise run test:e2e-gitlab`).

### Editing views and preview

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Visual / Source tabs | Local / Hello. Switch between the tabs, then edit in each. | The other view and the preview follow every edit. Cursor and undo history survive a tab switch. | visual.spec, preview.spec |
| ☐ | Live preview | Type in either view. | The preview updates while you type, and earlier pages stay untouched. | preview.spec |
| ☐ | Preview → source jump | Click a word in the preview. | The editing view selects that word, and the clicked run is outlined in the preview. | preview.spec |
| ☐ | Preview follows the cursor | Move the cursor in either view ("Follow cursor" on). | The preview scrolls to that spot only if it is off-screen; nothing is drawn. Toggle off: it stays put. | preview-ux.spec |
| ☐ | Zoom, page number | Local / Advanced. Use the preview toolbar's zoom buttons and scroll. | Fit width by default, presets from 25 % to 400 %, and a "page n / total" readout. | preview-ux.spec |
| ☐ | Errors keep the last pages | Type `#foo(` in Source. | The preview dims but keeps the last good pages. The status bar shows "1 error". | preview-ux.spec |

### Visual view elements

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Headings, paragraphs, bold/italic | Local / Simple. Type `## ` at the start of a line, and select text and press Mod+B or Mod+I. | A heading appears, and the source gets `==`, `*x*` and `_x_`. | visual.spec, visual-toolbar.spec |
| ☐ | Lists (nested) | In a list item, press Enter, then Tab. | A new item, then a nested one that prints indented. | visual.spec |
| ☐ | Links | Select text, press Mod+K and enter a URL. Click inside the link and remove it. | The source gets `#link("…")[…]`, and removing the link removes the call. | visual-links-tables.spec |
| ☐ | Tables | Simple: edit a cell, then use **Insert table**, **Add row** and **Delete column**. | Editing a cell changes only that cell's `[…]` in the source. | visual-links-tables.spec |
| ☐ | Raw boxes (math, `#set`, …) | Hello: click the equation, edit its code, then press Escape. | The box shows its code while focused and the compiled snippet while not. | visual-compiled-boxes.spec |
| ☐ | Inline code, code blocks | Advanced → `chapters/method.typ`: edit the `ts` block and change its **Language** field. Press Mod+E on selected text. | The fence and the language update, and Mod+E toggles inline code. | visual-toc-and-code.spec |
| ☐ | Table of contents | Advanced → `main.typ` shows the `#outline` box rendered. Use the toolbar's **Table of contents** in Hello. | An `#outline()` block is inserted and renders the headings. | visual-toc-and-code.spec |
| ☐ | Text alignment | Select a paragraph, then use **Align left**, **Center**, **Align right**, **Justify** (Mod+Shift+L/E/R/J). | The source gets `#align(center)[…]` or `#par(justify: true)[…]`. The button for the current alignment is pressed. | visual-text-align.spec |
| ☐ | Track changes | Local / Hello. Turn on **Track changes** and edit the heading. | Insertions are marked and deletions struck through, in both views. The preview shows change bars. **Changes since …** toggles them. | changes.spec, demo-playground.spec |
| ☐ | Diagnostics | Type an error in a paragraph, for example `#nope`. | A wavy underline with a tooltip in Visual, a lint underline in Source, and a status bar label that jumps to the error when clicked. | diagnostics-summary.test.ts, preview-ux.spec |

### Images and figures

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Insert image (project file) | Local / Advanced. Use the toolbar's **Insert image** and pick `assets/logo.svg`. | An `#image("…")` block appears after the current paragraph. | image-upload.spec |
| ☐ | Upload / drop / paste images | Use the image popover's **Upload image…**, drop a PNG onto the text, or paste a screenshot. | The file is added to the project (`image.png`, then `image-2.png`, …) and inserted. | image-upload.spec |
| ☐ | Figures: caption, width, alt | Advanced → `chapters/results.typ`: click the bar chart figure. Use **Add caption** / **Remove caption**, **Width 50%**, drag a corner, and **Alt text**. | Each action is one undo step that edits only its argument. | visual-figures.spec |

### Multi-file projects

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | File bar | Local / Advanced. The tabs list every file, with the main file marked. | `.typ` files open in their own views, and images open as a preview with **Insert into …**. | multi-file-ui.spec |
| ☐ | New / Upload / Rename / Delete | Use the file bar buttons. Try to rename `main.typ`. | The change takes effect, and the main file is protected. | multi-file-ui.spec |
| ☐ | Cross-file jumps | Click chapter text in the preview. | That chapter's tab opens. | multi-file.spec |
| ☐ | Packages | Add `#import "@preview/…"` (needs internet). | The package downloads on first use. | engine unit tests |

### Comments

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Review comments | Select text and press **Comment** (Ctrl/Cmd+Alt+M). Reply, resolve and reopen the thread. | The thread shows in the side panel, with a highlight in both views and a marker in the preview margin. | comments.spec |
| ☐ | Comments while collaborating | In Collaborate mode, comment in one window. | The thread appears in the second window. | collab.spec |
| ☐ | *Soon:* comments as margin notes | Branch `task/comments-drafting`: comments become drafting margin notes in the source. Add checks here once it is merged. | | |

### Collaboration (server needed: `mise run demo`)

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Joining a room | Collaborate / Hello. | The status says "Connected to ws://127.0.0.1:1234". | collab.spec |
| ☐ | Two users | Click **Open a second window as Bob** and type in both windows. | Edits converge. Each user's Undo reverts only their own edits. | collab.spec |
| ☐ | Remote cursors | Move the cursor in one window. | The other window shows a colored caret with the user's name. | collab.spec |
| ☐ | Files in a room | Collaborate / Advanced. Create or rename a `.typ` file. | The other window follows. Images are not shared outside GitLab rooms. | collab unit tests |
| ☐ | Server missing | Stop the server and reload a Collaborate URL. | The status says "Server not reachable … `mise run demo`", and the page edits a local copy. Start the server: the status asks for a reload. | demo-playground.spec |

### GitLab rooms (fake GitLab)

| ✓ | Feature | Steps (mode / example) | Expected | Automated |
|---|---|---|---|---|
| ☐ | Loading a branch | GitLab (fake). | The file bar lists `main.typ`, `template.typ`, `helpers.typ`, the chapters and the SVGs. Images come from the server. | gitlab.spec |
| ☐ | Changes since … vs. last commit | In `main.typ` (Source tab), add a paragraph `Again.` after `#pagebreak()`. "Changes since …" covers only the main file for now. | Both windows mark the paragraph as inserted. | gitlab.spec |
| ☐ | Save version | Click **Save version**, enter a message and click **Apply**. | Both windows say "Saved version <sha> (Ann)", and "Changes since …" starts over. Saving again says "No changes to save". | gitlab.spec |
| ☐ | Upstream merge | Edit `main.typ` (as above). Choose "add a paragraph" and click **Simulate upstream commit**. | The status shows the fake commit. Both windows say "Merged new changes from GitLab", and the paragraph appears in the Introduction. Your edit is kept. | gitlab.spec, playground.test.ts |
| ☐ | Upstream conflict | Edit the "Introduction" heading. Choose "revise a heading" and click **Simulate upstream commit**. | "Changes on GitLab conflict with edits in /chapters/introduction.typ; not saved". The room keeps your text, with no conflict markers. Make the heading match and save again to resolve it. | gitlab-rooms.test.ts |
| ☐ | Uploads in a GitLab room | Upload an image and click **Save version**. | The image is part of the commit and shows in the second window. | gitlab-rooms.test.ts |
| ☐ | Fresh branch | Open `?room=gitlab%3Ademo%2Freport%40try-1`. | The branch starts at `main`, and its saves do not touch `main`. | gitlab.spec |

### Embedding

| ✓ | Feature | Steps | Expected | Automated |
|---|---|---|---|---|
| ☐ | `<typst-editor>` without a bundler | `mise run build:lib`, serve the repository root, and open `/examples/plain-html/`. | The element works and emits `change` events. | web-component.spec |

## What cannot run in an agent's sandbox

The Playwright specs, `mise run demo` and the server's WebSocket all need a browser or a bound
port, so a human runs them: `mise run test:e2e`, `mise run test:e2e-collab`,
`mise run test:e2e-gitlab`, and this checklist. The playground's logic is unit-tested without a
browser or port: `demo/playground*.test.ts`, `demo/server-status.test.ts`, and
`server/src/playground/playground.test.ts` (Hocuspocus in-process).
