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

## Using it from a bundler

`dist/lib/typst-editor.js` is a regular ES module whose assets are referenced through
`new URL('…', import.meta.url)`. Webpack 5, Rollup and Vite pick these files up and copy them.

- **Vite:** add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into
  `node_modules/.vite`, and the relative asset URLs stop resolving.
- **Other bundlers / CDNs:** copy `dist/lib` as it is and import `typst-editor.js` from there.

## Not covered yet

Publishing to npm, and React/Vue wrappers.
