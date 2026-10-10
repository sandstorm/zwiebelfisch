# Embedding the Typst editor

`mise run build:lib` builds the widget into `dist/lib`:

```
dist/lib/
  typst-editor.js              ES module, all dependencies bundled (CodeMirror, …)
  typst_engine_bg.wasm         Typst compiler and PDF export (~23 MB, ~9 MB gzipped)
  assets/engine.worker-*.js    the compile worker
  types/index.d.ts             TypeScript declarations
```

The module finds the worker and the wasm through `new URL(…, import.meta.url)`. Keep the three
files together and serve them from any path. Serve the wasm as `application/wasm` so it can be
compiled while it streams.

Importing the module does two things: it exports the JavaScript API, and it registers the
`<typst-editor>` element. Both are safe to import without a DOM, for example during SSR.

## 1. Custom element: `<typst-editor>`

```html
<script type="module" src="/vendor/typst-editor/typst-editor.js"></script>

<typst-editor id="doc" style="height: 600px">
  = Hello

  The initial source is the element's text. Common indentation is removed.
</typst-editor>

<script type="module">
  const doc = document.getElementById('doc');
  doc.addEventListener('change', (e) => save(e.detail.value));
  doc.value = '= Replaced\n';   // no change event for programmatic sets
</script>
```

| | |
|---|---|
| `value` attribute | Initial source. It takes precedence over the text content, and setting it later replaces the source. The property is not reflected back into the attribute, as with `<input>`. |
| `value` property | Reads the current source. Setting it replaces the source as one minimal edit, so the cursor and undo history survive. |
| `change` event | `CustomEvent<{ value: string }>`. It fires after every user edit, bubbles, and is `composed`. |
| size | `display: block`, with a default height of `24rem`. Set `height` on the element. |

To register the element under another tag name, call `defineTypstEditorElement('my-editor')`.
Registering it again under `typst-editor` does nothing.

See [examples/plain-html](../examples/plain-html/index.html). After building, serve the
repository root and open `/examples/plain-html/`.

### Why shadow DOM

The element renders into an **open shadow root**. Page CSS (a global `div { … }`, a reset) cannot
break the editor, and the editor's CSS cannot leak into the page.

Styles that must live inside the shadow root:

- **CodeMirror** mounts its styles into the root node of the editor's parent. The view is created
  after its container is attached to the shadow root, so CodeMirror finds the shadow root without
  being told.
- **Widget styles** (`src/typst-editor.css`, plus the feature styles
  `src/features/changes/changes.css`): `createTypstEditor` injects them into
  `host.getRootNode()`, which is the shadow root here and `document.head` otherwise.
- **ProseMirror** (Visual view) has no style mounting of its own. Its core CSS is vendored in
  `src/features/visual-view/visual-view.css` and injected together with the widget styles, so it
  ends up in the same place.

Theming goes through the CSS custom properties on `.typst-editor` (`--te-border`, `--te-accent`, …).
Custom properties inherit into shadow roots, so `typst-editor { --te-accent: rebeccapurple }` works.

## 2. JavaScript API: `createTypstEditor`

```ts
import { createTypstEditor } from 'typst-editor';

const host = document.getElementById('editor')!;   // attach it to the document first
const editor = createTypstEditor(host, {
  source: '= Hello\n',
  onChange: (source) => save(source),
});

editor.source;               // current text
editor.source = '= New\n';   // replace (minimal edit, also triggers onChange)
editor.destroy();
```

The editor fills `host`, so give `host` a height. Styles go into `document.head`, or into the
shadow root when `host` is inside one.

## 3. Other files, images and packages

The main file is the one that is compiled. The project's other files go into `files`, by absolute
path: Typst text as a string, anything else (images, CSV, …) as a `Uint8Array`.

```ts
const editor = createTypstEditor(host, {
  main: '/thesis.typ',                     // default '/main.typ'
  source: '#include "chapters/intro.typ"\n#image("logo.png")',
  files: {
    '/chapters/intro.typ': '= Introduction\n…',
    '/logo.png': new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()),
  },
});
editor.files = { ...editor.files, '/chapters/outro.typ': '= Outro' };   // replaces the map, recompiles
```

### The file panel

A file panel on the left shows the project as a tree. With `fileList: 'auto'` (the default) it is
open while the project has more than one file and collapsed to a narrow rail with a **Files**
button otherwise; `'show'` opens it from the start, `'hide'` removes it (rail included; dropped
files are then ignored). Once someone opens or closes it, that choice, the panel width and the
open folders are kept for the browser session (`sessionStorage`, keyed by the main path). Below a
widget width of 720px the open panel lies over the editing view and closes after a file is chosen.

- folders first, expandable; the main file marked, the shown file highlighted, icons by kind
  (Typst / image / data), the initials of collaborators in each file (also on closed folders);
  `.typ` files open in their own Visual/Source views, images open as a preview (drag an
  image from the panel into the Visual view to insert it there), data files as read-only text;
- **New file**, **New folder**, **Upload** (or drop files onto the editor, or onto a folder),
  **Rename**, **Delete** on the focused row — a folder is renamed / deleted with every file in it
  (one change each); the main file (and the folder holding it) cannot be renamed, moved or
  deleted; drag rows onto folders to move them; a new folder exists in the panel only until a
  file goes into it;
- keyboard: arrow keys, Home/End, Enter (open / expand), F2 (rename), Delete;
- clicking preview text that comes from another file opens that file; error entries in the status
  bar open their file too;
- **file links**: paths in `#import "…"`, `#include "…"`, `image("…")`, `read("…")`,
  `bibliography("…")`, `json/csv/yaml/toml/xml/cbor("…")` open their file — Ctrl/⌘+click or
  Alt+Enter in the Source view (the hover tooltip says so), "Open …" above a Visual raw box, the
  path in an image box's heading. A missing `.typ` file can be created from there (through
  `allowFileChange` like every other change).

The host decides and persists:

```ts
createTypstEditor(host, {
  files,
  allowFileChange: async (change) => confirmWithServer(change),   // false → refused, the user sees why
  onFilesChange: (change) => save(change),   // {kind:'create'|'update'|'delete'|'rename', path, …}
});
editor.activeFile;              // '/chapters/intro.typ'
editor.open('/logo.png');
```

`onOpen(path)` (on `<typst-editor>`: the `open` event, `detail.path`) reports when another file is
shown, e.g. to keep it in the page URL. The demo stores it in the fragment (`#/chapters/intro.typ`,
`demo/open-file-hash.ts`). `followCursor: false` starts the preview without following the cursor.
The viewer can switch "Follow cursor" in the preview toolbar, and the choice is remembered in localStorage.

`onFilesChange` also reports every edit of a `.typ` file (`kind: 'update'`, with the full text).
`editor.files` returns all files but the main one, with their current text.

On `<typst-editor>` the same map is the `files` property, the `file-list` attribute sets the
file panel mode, and every file change dispatches a `files-change` event (`detail`: the change). Bytes are copied to the compile worker
only when the `Uint8Array` changes, so reuse the same array for unchanged files.

`#import "@preview/name:version"` works without configuration: the worker downloads the package
from `https://packages.typst.org/preview/` on first use and keeps it in the Cache API. Allow that
origin in your Content-Security-Policy (`connect-src`).

## 4. Comments are margin notes in the source

Users select text (or place the cursor) and press **Comment** (in the Visual view's formatting
toolbar; in the Source view it sits in the tab bar) or Ctrl/Cmd+Alt+M. This writes a
[`drafting`](https://typst.app/universe/package/drafting/) margin note into the Typst source and
puts the cursor into it. A note is a thread: one list item per message, signed with the
widget's `user.name` and the local date:

```typst
#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults
#set-margin-note-defaults(…)   // the notes' look in the PDF, see below
This is #margin-note[the selected text][- *Ada* (2026-10-10): Is this right?
- *Bob* (2026-10-11): Yes.] and a point note.#margin-note[Cite?]
```

The import is added once at the top of the file (or an existing drafting import is extended).
With an import it adds itself, the editor also sets the notes' look once: small (8pt) text in a
box tinted like the Visual view's notes, a thin amber border and connector, the highlighted text
in the same tint. A file that calls `set-margin-note-defaults` already keeps its own style, and
the call is never added twice; edit or delete it like any other line.
The preview shows the notes the compiler draws in the page margin. drafting 0.2.2 fails on a page
margin that is a single length ("type relative length has no method `keys`"), so adding a note
turns a top-level `#set page(margin: 1.5cm)` into `margin: (right: 4cm, rest: 1.5cm)`. The Visual
view shows every note as a card in a gutter right of the text, beside the text it belongs to:
the thread (name, date and text per message; long threads collapse), a reply box
(Ctrl/Cmd+Enter sends), a pencil on your own messages (by name: a convenience, not a
permission) and on hand-written ones, delete on your last message, and "Resolve" (deletes the
note). A note written by hand without names and dates (`#margin-note[Cite?]`) shows as one
message and stays as written until someone replies. On narrow panes the card pops up when you
click the highlighted text.
There is nothing extra to store or wire up: notes arrive with `onChange` / `change` and travel
through git, diffs and collaboration like any other text (two people replying at once give two
list items). Resolving a note means deleting it.

### PDF with or without comments

The preview toolbar has **Download PDF**: the plain button saves the PDF without comments (the
usual final version, `main.pdf`), its menu (▾) offers **Without comments** and **With comments**
(`main-with-comments.pdf`, the notes as the preview shows them). The name follows the main file.
If the document has errors, the toolbar says so and nothing is downloaded (never an older PDF).

Hosts can make the file themselves, e.g. to upload it:

```ts
const blob = await editor.exportPdf({ comments: false });   // application/pdf; rejects with the first error
createTypstEditor(host, { pdfDownload: false });            // no button (exportPdf still works)
```

On `<typst-editor>`: `element.exportPdf({ comments })`, and `pdf-download="hide"` removes the button.

Without comments, the document is not changed: the export compiles copies of the `.typ` files
with every note call removed (a range note keeps its text, without the highlight), through a
generated entry that also sets drafting's `hidden: true` for notes written some other way
(e.g. `#let todo = margin-note.with(..)`). drafting's `hidden` alone is not used, because it
drops the highlighted text of range notes as well. A document that sets
`set-margin-note-defaults(hidden: false)` itself shows those other notes again.

**Breaking change.** The earlier sidecar comments are gone. These APIs were removed:

- `createTypstEditor` options `comments` and `onCommentsChange`, and the `comments`
  getter/setter on the returned editor;
- on `<typst-editor>`: the `comments` property and the `commentschange` event;
- the exported types `CommentsData` and `TypstEditorCommentsChangeDetail`;
- the `comments` map in the collaboration Y.Doc (rooms that still hold one simply ignore it).

`user` stays: it is the name others see when collaborating, the author of saved versions and the
signature of comments (without it, comments are signed "Anonymous").
Existing `*.comments.json` sidecar files are not migrated.

## Custom styles

Authors declare their own paragraph and text styles as Typst functions, with a doc comment
above them (in any `.typ` file of the project, usually `styles.typ`):

```typst
/// @style paragraph Note
#let note(body) = block(fill: luma(240), inset: 8pt, radius: 4pt, body)

/// @style text Keyword
#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)
```

The Visual view's text style menu then offers *Note* (it wraps the selected paragraphs in
`#note[…]`) and *Keyword* (it puts `#key[…]` around the selection), and imports the function
where it is used (`#import "styles.typ": note`). Styled text stays editable. *Normal text* takes
paragraphs out of their style again. "New style…" adds a style to `styles.typ` to start from.

In the Visual view a paragraph style shows as a frame with its name, a text style as dotted
underlined text; the preview shows the real look. Each carries the class `typst-style--<name>`
(`typst-style--note`), so a host can give them a closer look with its own CSS. Calls of functions
that are not declared stay code boxes, as before.

## 5. Real-time collaboration

Several people can edit the same project at once. Pass `collaboration`, and set `user` to the
name the others see next to your cursor:

```js
createTypstEditor(host, {
  source,                                   // seeds a new room; an existing room's text wins
  user: { name: 'Ada Lovelace', color: '#6c71c4' },   // color optional
  collaboration: { url: 'wss://collab.example.org', room: 'project-42', token },   // Hocuspocus server
});
```

- **What is shared:** the text of every `.typ` file (create / rename / delete included, margin
  notes with it), through one Y.Doc per room. Images and other files are not
  shared (except in GitLab rooms, below); every widget keeps those it was given. Each user's Undo only reverts that user's edits.
- **With a server** (`{ url, room, token? }`): the widget connects to a
  [Hocuspocus](https://tiptap.dev/docs/hocuspocus) server (this repo's `server/`, `mise run
  server:dev`) and joins the room once it has synced. Until then it shows the local `source`.
- **With your own provider** (`{ doc, awareness? }`): pass a Y.Doc you have connected and
  **synced** yourself (y-websocket, y-webrtc, …), and its awareness for remote cursors. The Y.Doc
  must come from the same Yjs instance the widget uses, so bundle the widget from source with
  your Yjs (deduplicated); `dist/lib` bundles its own copy.
- `onChange` / `onFilesChange` also fire for the others' edits.
- On `<typst-editor>`, set the `collaboration` and `user` properties before the element is
  connected.

Demo: `mise run demo` starts the demo and a local server together; pick **Collaborate** in the
playground bar and **Open a second window** as another user (see
[demo-playground.md](demo-playground.md)). With `mise run server:dev` instead, open the demo with
`?room=test` (and `&user=Ann`) in two windows.

### Rooms backed by a GitLab branch

With a server configured for GitLab, a room named `gitlab:<project id or path>@<branch>` is a
branch of a GitLab repository:

```js
createTypstEditor(host, {
  main: '/thesis.typ',                      // the repository's main file
  user: { name: 'Ada Lovelace' },           // the commit author (unless the server's token check knows better)
  collaboration: { url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token },
});
```

- **Loading:** the first user to open the room makes the server load the branch: every `.typ`
  file becomes shared text, the other files (images, data) are fetched by the widget from the
  server (`GET /rooms/<room>/files/<path>`, with the token as `Authorization: Bearer`). Pass
  `main` as the repository's main file; `source` / `files` are not needed (the room wins).
- **Save version:** a "Save version" button appears next to the tabs. It asks for a commit
  message (default "Edit via Typst editor") and makes the server commit every change since the
  last commit (edits, new, renamed and deleted files, uploaded images) as **one** commit by the
  saving user. Everyone's "Changes since …" then starts over from the new commit.
- **Changes on GitLab** (pushes, merge requests): merged into the room when someone saves (and,
  with the webhook, as soon as they are pushed), file by file, three-way. Where the room and
  GitLab changed the same lines, nothing is merged or committed: everyone sees "Changes on GitLab
  conflict with edits in …", and the room keeps its text — no conflict markers in the source.
  Resolve it (e.g. on GitLab, or by editing those lines to match), then save again.

Server configuration (environment, e.g. in a git-ignored `mise.local.toml` `[env]` section —
never commit the token):

| Variable | |
|---|---|
| `TYPST_GITLAB_URL` | GitLab instance, e.g. `https://gitlab.com` |
| `TYPST_GITLAB_TOKEN` | server-side token with `api` scope (clients never see it) |
| `TYPST_GITLAB_WEBHOOK_SECRET` | optional: enables `POST /gitlab/webhook`; add a push webhook with this secret token in the project |
| `TYPST_GITLAB_AUTHOR_EMAIL` | optional: author email when the user's is unknown |

Try it without GitLab: `mise run demo` (the demo plus a server with an in-memory fake repository
holding the demo's advanced example), then pick **GitLab (fake)** in the playground bar, or open
`?room=gitlab:demo/report@main`. **Simulate upstream commit** in the bar pushes a change to the
fake repository, to try merges and conflicts. See [demo-playground.md](demo-playground.md).

## Using it from a bundler

`dist/lib/typst-editor.js` is a regular ES module whose assets are referenced through
`new URL('…', import.meta.url)`. Webpack 5, Rollup and Vite pick these files up and copy them.

- **Vite:** add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into
  `node_modules/.vite`, and the relative asset URLs stop resolving.
- **Other bundlers / CDNs:** copy `dist/lib` as it is and import `typst-editor.js` from there.

## Not covered yet

Publishing to npm, and React/Vue wrappers.

### Changes since …

The toggle above the editor compares every Typst file of the project with its own base version and
names that version: "Changes since opened" by default (each file's text when the editor opened, or
in a collaboration room after the first sync; a file created since is new as a whole; off until
clicked), "Changes since last saved version" in GitLab rooms (each file at the branch's last
commit; a file added since is new as a whole), or what the host gives: `base` + `baseLabel`
options (the main file), `editor.setBase(text, label, path?)` (the main file, or `path`; other
files keep their bases, the label is shared). `setBase(null)` goes back to "since opened" for
every file. The Visual and Source views of each file and the preview's change bars (for all
files at once) follow; accepting a chunk in the Source view moves that file's base.
