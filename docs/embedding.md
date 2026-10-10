# Embedding the Typst editor

`mise run build:lib` builds the widget into `dist/lib`:

```
dist/lib/
  typst-editor.js              ES module, all dependencies bundled (CodeMirror, …)
  typst_engine_bg.wasm         Typst compiler (~40 MB, ~16 MB gzipped)
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
- **Widget styles** (`src/editor/styles.css`): `createTypstEditor` injects them into
  `host.getRootNode()`, which is the shadow root here and `document.head` otherwise.
- **ProseMirror** (visual view, planned) has no style mounting of its own. Its CSS has to go into
  `styles.css` so that it ends up in the same place.

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

### The file bar (optional)

With one file the widget looks as before. As soon as the project has more than one file
(`fileList: 'auto'`, the default; `'show'` / `'hide'` force it), a file bar appears above the
editing view:

- one tab per file, the main file marked; `.typ` files open in their own Visual/Source views,
  images open as a preview with an **Insert into …** button, data files as read-only text;
- **New file**, **Upload** (or drop files onto the editor), **Rename**, **Delete** — the main
  file cannot be renamed or deleted, folders are at most one level deep;
- clicking preview text that comes from another file opens that file; error entries in the status
  bar open their file too.

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

`onFilesChange` also reports every edit of a `.typ` file (`kind: 'update'`, with the full text).
`editor.files` returns all files but the main one, with their current text.

On `<typst-editor>` the same map is the `files` property, the `file-list` attribute sets the
file bar mode, and every file change dispatches a `files-change` event (`detail`: the change). Bytes are copied to the compile worker
only when the `Uint8Array` changes, so reuse the same array for unchanged files.

`#import "@preview/name:version"` works without configuration: the worker downloads the package
from `https://packages.typst.org/preview/` on first use and keeps it in the Cache API. Allow that
origin in your Content-Security-Policy (`connect-src`).

## 4. Review comments

Users select text and press **Comment** (or Ctrl/Cmd+Alt+M). Threads with replies, resolve and
reopen show in a side panel. The commented text is highlighted in both views, and a marker sits
in the preview margin. Comments are **never written into the Typst source**. The host stores
them beside the file, for example as `main.typ.comments.json`:

```js
const editor = createTypstEditor(host, {
  source,
  comments: await load('main.typ.comments.json'),   // JSON string from onCommentsChange, optional
  user: { name: 'Ada Lovelace' },                   // author of new comments
  onCommentsChange: (json) => save('main.typ.comments.json', json),
});
editor.comments = json;   // replace all threads (e.g. after a pull); anchors are found again
```

`onCommentsChange` also fires when edits move a comment's anchor. Each anchor is stored as a W3C
TextQuoteSelector (`exact` text with `prefix`/`suffix` context) plus a `start`/`end` hint. When
the source was changed elsewhere, the comment attaches to the best-matching occurrence. If the
text is gone, the thread is listed as "Text deleted". On `<typst-editor>`, set the `comments` and
`user` properties and listen for `commentschange` (`detail.comments`).

## Using it from a bundler

`dist/lib/typst-editor.js` is a regular ES module whose assets are referenced through
`new URL('…', import.meta.url)`. Webpack 5, Rollup and Vite pick these files up and copy them.

- **Vite:** add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into
  `node_modules/.vite`, and the relative asset URLs stop resolving.
- **Other bundlers / CDNs:** copy `dist/lib` as it is and import `typst-editor.js` from there.

## Not covered yet

Publishing to npm, and React/Vue wrappers.
