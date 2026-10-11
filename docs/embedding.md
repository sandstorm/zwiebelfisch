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
  doc.addEventListener('change', (e) => save(e.detail.path, e.detail.content));
  doc.value = '= Replaced\n';   // no change event for programmatic sets
</script>
```

| | |
|---|---|
| `options` property | `Partial<TypstEditorOptions>`: everything `createTypstEditor` takes (section 2), read when the element connects. Set it before appending the element (or before the module has defined it: it is picked up then). Its `onFilesChange` / `onOpen` are called as well as the events. |
| `settings` attribute | A JSON object of settings by id (section 6), e.g. `settings='{"pdfExport.download": false, "workbench.theme": "dark"}'`, over `options.settings` id by id. Read when the element connects and again whenever it changes. Not a JSON object: ignored, with a console warning. |
| `settings` property | The current settings; setting it replaces them (ids left out go back to their default). |
| main file's text | The `value` property or attribute, else the element's text content (common indentation removed), else `options.source`, else `options.files[main]`. |
| `value` property | The main file's text (a shortcut for `files[main]`). Setting it replaces the text as one minimal edit, so the cursor and undo history survive. The property is not reflected back into the attribute, as with `<input>`. |
| `files` property | Every file, the main file included (see section 3). Setting it replaces them all. |
| `change` event | `CustomEvent<TypstEditorChangeDetail>`, `detail: { path, content }`: what the file at `path` (a project path such as `/main.typ`) holds after a change, `content: null` when it is gone. It fires for every file whose content changes — edits in any file, new and deleted files, the others' edits when collaborating; a rename fires twice (old path with `null`, new path with the content). |
| `files-change` event | `CustomEvent<FileChange>`: the same as `onFilesChange`, with renames as such. |
| `open` event | `CustomEvent<{ path }>`: another file is shown (`onOpen`). |
| `executeCommand(id, ...args)` | Runs an extension's command (section 7), e.g. `exportPdf` below is `pdfExport.export`. |
| | Setting `value` or `files` dispatches no events. All events bubble and are `composed`. |
| size | `display: block`, with a default height of `24rem`. Set `height` on the element. |

```js
const editor = document.createElement('typst-editor');
editor.options = { main: '/thesis.typ', files, mode: 'source', user: { name: 'Ada' } };
editor.setAttribute('settings', JSON.stringify({ 'files.panel': 'show' }));   // over options.settings
document.body.append(editor);               // options are read now
```

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
- **Widget styles** (`src/typst-editor/typst-editor.css`, and each extension's own, such as
  `src/extensions/files/files.css`, registered with `Workbench.registerStyleSheet`): the widget injects them
  into `host.getRootNode()`, which is the shadow root here and `document.head` otherwise.
- **ProseMirror** (Visual view) has no style mounting of its own. Its core CSS is vendored in
  `src/hosts/visual-view/visual-view.css` and injected together with the widget styles, so it
  ends up in the same place.

Theming goes through the CSS custom properties on `.typst-editor` (`--te-border`, `--te-accent`, …).
Custom properties inherit into shadow roots, so `typst-editor { --te-accent: rebeccapurple }` works.

**Dark mode.** The editor takes the page's CSS `color-scheme`: light by default, dark where the page
declares `color-scheme: dark`, and following the OS where it declares `color-scheme: light dark`.
To choose regardless of the page, set the setting `workbench.theme` to `'light' | 'dark' | 'auto'` (`auto`: as
the OS; section 6): `createTypstEditor(host, { settings: { 'workbench.theme': 'dark' } })`, `editor.settings = {
'workbench.theme': 'light' }` later, or `settings='{"workbench.theme": "dark"}'` on `<typst-editor>`. The colors are
`light-dark(..)` tokens. In dark mode the preview shows the pages inverted (white text on black,
as dark-mode PDF readers do); the exported PDF is unchanged. Spreadsheets get dark colors made from
the same tokens (colors set on cells stay).

## 2. JavaScript API: `createTypstEditor`

```ts
import { createTypstEditor } from 'typst-editor';

const host = document.getElementById('editor')!;   // attach it to the document first
const editor = createTypstEditor(host, {
  source: '= Hello\n',                                 // the main file's text
  onFilesChange: (change) => save(change),            // every change to any file, see section 3
});

editor.source;               // the main file's current text
editor.source = '= New\n';   // replace (minimal edit, reported to onFilesChange as an update)
editor.dispose();
```

`source` is a shortcut for the main file's text, for hosts with a single file. Everything else
goes through `files`, which always includes the main file.

The editor fills `host`, so give `host` a height. Styles go into `document.head`, or into the
shadow root when `host` is inside one.

## 3. Other files, images and packages

`files` holds every file of the project by absolute path, the main file included: Typst text as
a string, anything else (images, CSV, …) as a `Uint8Array` (a `.typ` file given as bytes throws). The
main file (`main`) is the one that is compiled; it cannot be renamed or deleted. `source`, if given, wins over `files[main]`.

```ts
const editor = createTypstEditor(host, {
  main: '/thesis.typ',                     // default '/main.typ'
  files: {
    '/thesis.typ': '#include "chapters/intro.typ"\n#image("logo.png")',
    '/chapters/intro.typ': '= Introduction\n…',
    '/logo.png': new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()),
  },
});
editor.files;                              // every file with its current content, '/thesis.typ' included
editor.files = { ...editor.files, '/chapters/outro.typ': '= Outro' };   // replaces the map, recompiles
```

Assigning `files` replaces every file: paths that are missing are deleted, new ones created,
changed ones updated (open views keep their cursor), and each change is reported to
`onFilesChange`. The main file cannot be deleted: a map without it leaves its text as it is.

### The file panel

A file panel on the left shows the project as a tree. With the setting `files.panel: 'auto'` (the default) it is
open while the project has more than one file and collapsed to a narrow rail with a **Files**
button otherwise; `'show'` opens it from the start, `'hide'` removes it (rail included; dropped
files are then ignored). Once someone opens or closes it, that choice, the panel width and the
open folders are kept for the browser session (`sessionStorage`, keyed by the main path). Below a
widget width of 720px the open panel lies over the editing view and closes after a file is chosen.

- folders first, expandable; the main file marked, the shown file highlighted, icons by kind
  (Typst / image / data), the initials of collaborators in each file (also on closed folders);
  `.typ` files open in their own Visual/Source views, images open as a preview (drag an
  image from the panel into the Visual view to insert it there), data files as read-only text;
- **New** (`+` in the panel's header) offers **New file…**, **New folder…** and **Upload files…**
  into the focused row's folder (or drop files onto the editor, or onto a folder); a row's context
  menu (right click, Shift+F10 or the context menu key) offers the same for its folder, and
  **Rename…** and **Delete** — a folder is renamed / deleted with every file in it (one change
  each); the main file (and the folder holding it) cannot be renamed, moved or deleted; drag rows
  onto folders to move them; a new folder exists in the panel only until a file goes into it.
  Names are asked in a small input box below the panel's button or row, deleting asks for a
  confirmation, and a refused change is shown as an error message;
- keyboard: arrow keys, Home/End, Enter (open / expand), F2 (rename), Delete, Shift+F10 (menu);
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
  allowFileChange: async (change) => confirmWithServer(change),   // false → refused, the user sees why (a message)
  onFilesChange: (change) => save(change),   // {kind:'create'|'update'|'delete'|'rename', path, …}
});
editor.activeFile;              // '/chapters/intro.typ'
editor.open('/logo.png');
```

`onOpen(path)` (on `<typst-editor>`: the `open` event, `detail.path`) reports when another file is
shown, e.g. to keep it in the page URL. The demo stores it in the fragment (`#/chapters/intro.typ`,
`demo/open-file-hash.ts`). The setting `previewSync.followCursor: false` has the preview not follow the cursor.
The viewer can switch "Follow cursor" in the preview toolbar; without the setting, that choice is remembered in
localStorage and wins over the default.

`onFilesChange` reports every change to any file, the main file included: every edit of a `.typ`
file (`kind: 'update'`, with the full text), create / rename / delete, collaborators' changes,
and assignments to `files` or `source`. It is the one place to hear about changes.

On `<typst-editor>` the same map is the `files` property, the `settings` attribute sets the
file panel mode (`files.panel`), and every file change dispatches `change` (`{ path, content }`) and
`files-change` (the `FileChange`). Bytes are copied to the compile worker
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
There is nothing extra to store or wire up: notes arrive with `onFilesChange` / `change` and travel
through git, diffs and collaboration like any other text (two people replying at once give two
list items). Resolving a note means deleting it.

### PDF with or without comments

The preview toolbar has one **Download PDF** button. It opens a popover with a checkbox per export
option and **Download**; the built-in option is **Include comments** (`comments.include`, off by
default: the usual final version; on: the notes as the preview shows them). Each viewer's choices are
remembered for the browser session. The file is named after the main file (`main.pdf`). If the
document has errors, an error message says so ("No PDF: …") and nothing is downloaded (never an older PDF).

The widget tells its users about refusals and failures (a refused new file, rename or upload, no PDF, a
failed save to GitLab) in small messages at its bottom right: information closes by itself, warnings and
errors stay until closed. Values it needs (a link's URL, a new file's name, a commit message) are asked in
a small input box next to what was clicked.

Hosts can make the file themselves, e.g. to upload it. Options are given by id; the others keep their
default (not what the viewer chose), and an id no extension registered rejects:

```ts
const blob = await editor.exportPdf();                                          // without comments
const draft = await editor.exportPdf({ 'comments.include': true });            // with them
createTypstEditor(host, { settings: { 'pdfExport.download': false } });   // no button (exportPdf still works)
```

`exportPdf(options?)` is the one feature shortcut on the widget: the command `pdfExport.export`
(`editor.executeCommand('pdfExport.export', { 'comments.include': true })`). On `<typst-editor>`:
`element.exportPdf(options?)`, and `settings='{"pdfExport.download": false}'` removes the button.

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

`user` stays: it is the name others see when collaborating, the author of commits to GitLab and the
signature of comments (without it, comments are signed "Anonymous").
Existing `*.comments.json` sidecar files are not migrated.

## Spreadsheets

A project file ending in `.ic` is a spreadsheet: it opens in [IronCalc](https://www.ironcalc.com)'s
workbook UI (formulas, formats, several sheets), loaded only when the first spreadsheet opens.
Create one with **New → New spreadsheet…** in the file panel (or **New file** `budget.ic`). Every edit is saved into the file and, for Typst, into
`budget.ic.gen.typ` next to it (generated: don't edit it). It defines two dictionaries by sheet
name: `sheets`, every sheet as a table that looks like the spreadsheet (column widths, row
heights, alignment, background colours, bold / italic / coloured text, borders), and `values`,
the cells as displayed.

```typst
#import "budget.ic.gen.typ": sheets, values
#sheets.Sheet1
Rent: #values.Sheet1.at(1).at(1)
```

The tables use Typst's table stroke for the grid lines (`#set table(stroke: none)` hides them)
and the document's font. Merged cells are not carried over yet.

The file is in IronCalc's own format; `.xlsx` files cannot be opened yet.

## Diagrams

A project file ending in `.drawio.png` is a diagram: a PNG with the [diagrams.net](https://www.diagrams.net)
diagram inside, so Typst shows it as an image and the editor opens it in diagrams.net, embedded. Create one with
**New → New diagram…** in the file panel; in the Visual view, an image of a diagram has **Edit diagram** in its
toolbar. There is no Save button: every change is saved into the file (and the preview updates) as you draw.

```typst
#figure(image("diagrams/architecture.drawio.png", width: 80%), caption: [Architecture])
```

The editor follows the widget into dark mode. It is loaded from `https://embed.diagrams.net/`; set
`diagrams.editorUrl` to your own installation of the drawio web app to keep diagrams off the internet or to work
offline. Without it the editor says so and offers to show the picture instead.

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
paragraphs out of their style again. "New style…" asks for a name and adds a style of that name to
`styles.typ` to start from.

In the Visual view a paragraph style shows as a frame with its name, a text style as dotted
underlined text; the preview shows the real look. Each carries the class `typst-style--<name>`
(`typst-style--note`), so a host can give them a closer look with its own CSS. Calls of functions
that are not declared stay code boxes, as before.

## 5. Real-time collaboration

Several people can edit the same project at once. Add the `collaboration` extension with the connection, and
set `user` to the name the others see next to your cursor:

```js
import { collaboration, createTypstEditor } from 'typst-editor';

createTypstEditor(host, {
  source,                                   // seeds a new room; an existing room's text wins
  user: { name: 'Ada Lovelace', color: '#6c71c4' },   // color optional
  // Hocuspocus server
  extensions: (builtins) => [...builtins, collaboration({ url: 'wss://collab.example.org', room: 'project-42', token })],
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
- `onFilesChange` (and `change` on `<typst-editor>`) also fire for the others' edits.
- On `<typst-editor>`, put `extensions` and `user` into its `options` before the element is
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
  extensions: (builtins) => [...builtins, collaboration({ url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token })],
});
```

- **Loading:** the first user to open the room makes the server load the branch: every `.typ`
  file becomes shared text, the other files (images, data) are fetched by the widget from the
  server (`GET /rooms/<room>/files/<path>`, with the token as `Authorization: Bearer`). Pass
  `main` as the repository's main file; `source` / `files` are not needed (the room wins).
- **Save to GitLab:** a "Save to GitLab…" button appears next to the tabs. It asks for a commit
  message (default "Edit via Typst editor") and makes the server commit every change since the
  last commit (edits, new, renamed and deleted files, uploaded images) as **one** commit by the
  saving user. Everyone in the room is told the outcome as a message ("Saved version 01234567
  (Ann)", "No changes to save", "Saving failed: …").
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

## 6. Settings

What a feature lets you configure is a **setting** its extension declares (VS Code's settings), by id
`<section>.<key>`. Give values with `settings`, change them later with `editor.settings` (assigning replaces
them all: ids left out go back to their default); the widget follows at once. Unknown ids and values of the wrong
type are ignored, with a console warning.

```ts
const editor = createTypstEditor(host, { settings: { 'pdfExport.download': false, 'files.panel': 'show' } });
editor.settings = { ...editor.settings, 'workbench.theme': 'dark' };
```

| Setting | Values (default) | |
|---|---|---|
| `workbench.theme` | `'light'`, `'dark'`, `'auto'` (`null`: as the page) | Light or dark colors; `auto`: as the OS. See "Dark mode". |
| `files.panel` | `'auto'`, `'show'`, `'hide'` (`'auto'`) | When the file panel is open: with more than one file / always / never (and dropped files are ignored). |
| `previewSync.followCursor` | `true`, `false` (unset: the viewer's last choice, else `true`) | Whether the preview follows the cursor. |
| `pdfExport.download` | `true`, `false` (`true`) | "Download PDF" in the preview toolbar. `exportPdf` works either way. |
| `diagrams.editorUrl` | a URL (`'https://embed.diagrams.net/'`) | Where the diagram editor comes from: diagrams.net, or your own installation of the drawio web app (Apache-2.0), e.g. without internet access. |

Your own extensions declare settings the same way (section 7).

## 7. Writing an extension

Everything the editor does beyond its frame is an **extension**, the built-in features too: an object with an
`id` and an `activate(context)` that registers what it adds (a status bar item, a preview toolbar item, a PDF
export option, a command, …) and pushes each registration into `context.subscriptions`, which the editor disposes
on `dispose`. The names and shapes are VS Code's: the context has its namespaces (`commands`, `window`, `scm`,
`languages`, `workspace`) next to the editor's own frame (`workbench`) and views (`visualView`, `sourceView`,
`preview`), and uses `registerCommand`, `onDidChange…`, `Disposable`, `getConfiguration`. Write an extension as a
function that makes it (`wordCount()`, as every built-in), so it can take options later. Give the editor your
extensions through `extensions`, a function that makes the list from the built-in ones:

```ts
createTypstEditor(host, { extensions: (builtins) => [...builtins, wordCount()] });               // add
createTypstEditor(host, { extensions: (builtins) => builtins.filter((e) => e.id !== 'pdf-export') }); // leave out
createTypstEditor(host, { extensions: (builtins) => [...builtins.filter((e) => e.id !== 'files'), myFiles] }); // replace
```

A complete example: the words of the shown file in the status bar, with a setting for its label and a command
the host can run.

```ts
import { createTypstEditor, type TypstExtension } from 'typst-editor';

export function wordCount(): TypstExtension {
  return {
    id: 'word-count',
    contributes: {
      configuration: {
        properties: {
          'wordCount.label': { type: 'string', default: 'words', description: 'Shown after the number.' },
        },
      },
    },
    activate({ project, commands, window, workspace, workbench, subscriptions }) {
      const item = workbench.ownerDocument.createElement('span');
      const count = () => {
        const text = window.activeTextEditor?.document.text ?? '';
        return text.split(/\s+/).filter(Boolean).length;
      };
      const show = () => {
        item.textContent = `${count()} ${workspace.getConfiguration('wordCount').get<string>('label')}`;
      };
      show();
      subscriptions.push(
        window.registerStatusBarItem(item, { alignment: 'right', priority: 100 }),
        workbench.onDidShowFile(show),
        project.onDidChangeFile(show),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('wordCount.label')) show();
        }),
        commands.registerCommand('wordCount.count', () => count()),
      );
    },
  };
}

const editor = createTypstEditor(host, {
  source: '= Hello\n\nSome words here.',
  settings: { 'wordCount.label': 'Wörter' },
  extensions: (builtins) => [...builtins, wordCount()],
});
await editor.executeCommand<number>('wordCount.count');   // 5
```

What `activate` gets (`ExtensionContext`; every type is exported from the package):

| | |
|---|---|
| `subscriptions` | Push every registration here; disposed on `dispose`, in reverse order. |
| `project` | The files: `files()`, `document(path)` (a Typst file's text), `onDidChangeFile` (an `Event<FileChange>`: subscribing returns a `Disposable`). |
| `commands` | `registerCommand(id, handler)`, `executeCommand(id, ...args)`, `registerKeybinding('Mod+Alt+KeyM', id)`. |
| `window` | `showInformationMessage` / `showWarningMessage` / `showErrorMessage`, `showInputBox`, `showQuickPick`, `registerStatusBarItem(element, { alignment, priority })` (VS Code's: `'left'` or `'right'`, a higher priority further left within its side), `registerCustomEditorProvider` (an editor for files by name pattern and priority, VS Code's custom editors), `registerFileDecorationProvider` / `getFileDecorations`, `activeTextEditor`, `onDidChangeTextEditorSelection`. |
| `scm` | `registerSourceControl`, `sourceControls`, `onDidChangeSourceControls`. |
| `languages` | `registerDocumentLinkProvider`, `provideDocumentLinks`, `resolveDocumentLink`. |
| `workspace` | `applyEdit(change)` (through the host's `allowFileChange`; resolves to the reason it was refused, or null), the settings: `getConfiguration('<section>').get('<key>')`, `onDidChangeConfiguration`. |
| `workbench` | The frame: `open(path, { viewType? })`, `activeFile`, `onDidShowFile`, `registerSidePanel(id, { label, icon, order? })`, `registerEditorFrame`, `registerMenuItem` / `getMenuItems`, `registerStyleSheet` (your CSS, inside the shadow root too), `onDidDropFiles`, `user`. |
| `preview` | `registerToolbarItem(item, { group, order })`, `registerPdfExportOption`, `reveal`, `onDidClickPage`, `onDidChangeDiagnostics`. |
| `visualView`, `sourceView` | Node and mark specs, toolbar items, decorations of the Visual view; CodeMirror extensions of the Source view. |

Rules the built-ins follow, and yours should too:

- **Extensions never depend on each other.** What one offers another goes through a generic contribution point
  (document links, file decorations, source controls) or a command by id, never an import.
- **Commands** are plain string ids `<extension>.<name>`. `commands.executeCommand<T>(id, ...args)` calls the
  handler at once and resolves to its result; it rejects for an unknown id or a failing handler.
- **Order never decides who wins**: toolbar items have a `group` and an `order` (the preview toolbar's groups are
  sorted by name: the built-ins use `1_sync`, `2_view`, `3_export`); Visual view nodes, marks and box renderers a
  `priority` (default 100, higher first).
- **Settings** are declared under the extension's own section and read with `getConfiguration`; follow
  `onDidChangeConfiguration`, since the host may change them at any time.
- **Buttons on Visual view boxes**: `visualView.registerBoxAction({ title, when?(node, view), run(node, view) })` adds
  a button to every raw box `when` holds for (its Typst is `node.attrs.src`), shown in the box's tools (an image's
  toolbar) or above its code; `diagrams`' "Edit diagram" is one.
- **Buttons are menu entries.** `workbench.registerMenuItem(menuId, { command, title?, icon?, group?, order?, when?(context)
  })` puts a command where the user finds it; `when` decides per menu context. Menu ids (VS Code's):

  | Menu | Where | Context | Command gets |
  |---|---|---|---|
  | `editor/title` | The Visual / Source tab bar | `{ editorMode: 'visual' \| 'source', resource }` | nothing |
  | `file/newFile` | "New" in the file panel's header | `{ view: 'files', resource, resourceKind: 'file' \| 'folder', resourceIsMain }` | the row |
  | `explorer/context` | A file panel row's context menu | as `file/newFile` | the row |

  Entries sort with group `navigation` first, the other groups by name, then `order`.
- **Talk to the user through `window`**, not your own popups: `showInformationMessage` /
  `showWarningMessage` / `showErrorMessage(message, ...items)` resolve to the button pressed (a string or a
  `MessageItem { title }`) or `undefined`; `showInputBox({ title, prompt, value, validateInput })` to the text
  or `undefined`; `showQuickPick(items, { placeHolder, canPickMany })` to the picked `QuickPickItem` (or
  string) or `undefined`.

- **Files other than Typst open in custom editors** (VS Code's): `window.registerCustomEditorProvider(viewType, provider,
  { filenamePattern, priority? })`. The pattern is a glob over the file name (`*.csv`, `*.{png,jpg}`; with a `/`
  over the path). Of the editors matching a file, the highest `priority` opens it (`'default'`: 100, or a number;
  `'option'` only through `workbench.open(path, { viewType })`), then the most specific pattern (`*.drawio.png` beats
  the images' `*.{png,…}`, which beats `*`). Every open gets a new panel: fill `panel.element`, store edits with
  `workspace.applyEdit({ kind: 'update', path, content })`, and store what is pending in `panel.onDidDispose`. The built-ins:
  `images.preview` (images), `images.file` (`*`: any other file, read-only), `spreadsheets.editor` (`*.ic`),
  `diagrams.editor` (`*.drawio.png`, priority 110). The built-in "New …" entries (`file/newFile`): "New file…",
  "New spreadsheet…" (`spreadsheets.newSpreadsheet`), "New diagram…" (`diagrams.newDiagram`), "New folder…",
  "Upload files…".

  ```ts
  window.registerCustomEditorProvider('csv.table', {
    resolveCustomEditor(document, panel) {
      const text = typeof document.content === 'string' ? document.content : new TextDecoder().decode(document.content);
      panel.element.append(renderTable(text));            // yours
    },
  }, { filenamePattern: '*.csv' });
  ```

```ts
commands.registerCommand('wordCount.countFile', async (path: ProjectPath) => {
  const words = (project.document(path)?.text ?? '').split(/\s+/).filter(Boolean).length;
  const choice = await window.showInformationMessage(`${path}: ${words} words`, 'Open');
  if (choice === 'Open') workbench.open(path);
});
workbench.registerMenuItem('explorer/context', {
  command: 'wordCount.countFile', title: 'Count words', when: (context) => context.resourceKind === 'file',
});
```

## Migrating from the earlier API

- Per-feature options are settings now (section 6): `pdfDownload: false` → `settings: { 'pdfExport.download':
  false }`, `fileList` → `'files.panel'`, `followCursor` → `'previewSync.followCursor'`, `theme` →
  `'workbench.theme'`. On `<typst-editor>`, the attributes `file-list`, `pdf-download` and `theme` are one
  `settings` attribute (JSON).
- `collaboration: { … }` → `extensions: (builtins) => [...builtins, collaboration({ … })]` (`collaboration` is
  exported from the package).

- `onChange(source)` is gone: use `onFilesChange` and look for `{ kind: 'update', path: main }`
  (or read `editor.source` there).
- `files` (option, getter, setter) now includes the main file. A map without the main file still
  works: the main file keeps its text.
- `<typst-editor>`: the `user` and `collaboration` properties are gone (put them into `options`);
  `change` carries `{ path, content }` for every file instead of `{ value }` for the main file.

## Using it from a bundler

`dist/lib/typst-editor.js` is a regular ES module whose assets are referenced through
`new URL('…', import.meta.url)`. Webpack 5, Rollup and Vite pick these files up and copy them.

- **Vite:** add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into
  `node_modules/.vite`, and the relative asset URLs stop resolving.
- **Other bundlers / CDNs:** copy `dist/lib` as it is and import `typst-editor.js` from there.

## Not covered yet

Publishing to npm, and React/Vue wrappers.
