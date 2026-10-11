= Embedding <reference-embedding>

Two ways in, same options (@reference-configuration):

#table(
  columns: 2,
  [Use], [When],
  [`<typst-editor>` (@reference-embedding-element)], [Plain HTML or any framework that renders elements, no glue code: text inside the tag, settings as an attribute, changes as DOM events, gone with the element. A shadow root keeps the page's CSS and the editor's apart.],
  [`createTypstEditor(host, options)` (@reference-embedding-api)], [Your code drives the editor: the returned handle (commands, `exportPdf`, `dispose`) and callbacks. It fills `host` in your page's DOM; its styles go into the page's document (or the shadow root `host` is in).],
)

== The library build <reference-embedding-library>

`mise run build:lib` writes `dist/lib`:

#table(
  columns: 2,
  [File], [Content],
  [`typst-editor.js`], [ES module, all dependencies bundled. Importing it registers `<typst-editor>`.],
  [`typst_engine_bg.<hash>.wasm`], [The Typst compiler and PDF export (about 22 MB, 9 MB gzipped).],
  [`fonts/<name>.<hash>.otf`, `.ttf`], [Typst's default fonts, each downloaded when a document first uses it.],
  [other `*-<hash>.js`], [Chunks loaded on demand (e.g. collaboration).],
  [`assets/engine.worker-<hash>.js`], [The compile worker.],
  [`types/index.d.ts`], [TypeScript declarations.],
)

- Keep the folder together; serve it from any path. The module finds its files through `new URL(…, import.meta.url)`.
- Every file but `typst-editor.js` and `types/` has its content's hash in the name, and the code refers to it by that name.

What the host server should send:

- The wasm as `Content-Type: application/wasm`, so the browser compiles it while it streams.
- For the hashed files, `Cache-Control: public, max-age=31536000, immutable`: a new build has new names, so a long-lived cache never serves a stale file. `typst-editor.js` has a fixed name: cache it briefly or revalidate it (`no-cache` with an `ETag`).
- Compression is up to the server (gzip or brotli on the fly or pre-compressed by the host); the build writes no compressed copies. The wasm shrinks most (22 MB → 9 MB gzipped), the fonts by about a third.
- Importing without a DOM (SSR) is safe: nothing is registered.
- Content-Security-Policy: `connect-src https://packages.typst.org` for `@preview` packages; the diagram editor is an iframe from `https://embed.diagrams.net` (setting `diagrams.editorUrl`, @reference-configuration-diagrams).

Bundlers:

- *Vite:* add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into `node_modules/.vite` and breaks the relative asset URLs.
- *Webpack 5, Rollup:* pick up the `new URL(…)` assets and copy them.
- *Anything else:* copy `dist/lib` as it is and import `typst-editor.js` from there.

== Custom element <reference-embedding-element>

```html
<script type="module" src="/vendor/typst-editor/typst-editor.js"></script>

<typst-editor id="doc" settings='{"workbench.theme": "dark"}'>
  = Hello

  The initial source is the element's text, common indentation removed.
</typst-editor>

<script type="module">
  const doc = document.getElementById('doc');
  doc.addEventListener('change', (e) => save(e.detail.path, e.detail.content));
  doc.value = '= Replaced\n';   // no event for programmatic sets
</script>
```

#table(
  columns: 2,
  [Member], [Behaviour],
  [`options` property], [`Partial<TypstEditorOptions>` (@reference-configuration-options), read when the element connects. Set it before appending the element. Its `onFilesChange` / `onOpen` run as well as the events.],
  [`settings` attribute, property], [The settings (@reference-configuration-setting).],
  [`value` property, attribute], [The main file's text. Setting it is one minimal edit: cursor and undo history survive. The property is not reflected to the attribute.],
  [`files` property], [Every file, the main file included. Setting it replaces them all.],
  [`executeCommand(id, ...args)`], [Runs an extension's command; rejects while not connected.],
  [`exportPdf(options?)`], [The PDF as a `Blob` (@reference-embedding-pdf).],
  [`change` event], [`detail: { path, content }`: what the file at `path` holds now; `content: null` when it is gone. Fires for every changed file, the collaborators' edits included. A rename fires twice: old path with `null`, new path with the content.],
  [`files-change` event], [`detail`: the `FileChange`, renames as such (`onFilesChange`).],
  [`open` event], [`detail: { path }`: another file is shown (`onOpen`).],
)

- Main file's text, first found: `value` (property or attribute), the element's text, `options.source`, `options.files[main]`.
- Setting `value` or `files` dispatches no events. All events bubble and are `composed`.
- Size: `display: block`, default height `24rem`. Set `height` on the element.
- Moving the element keeps its content; the editor inside is rebuilt.
- Another tag name: `defineTypstEditorElement('my-editor')`.

```js
const editor = document.createElement('typst-editor');
editor.options = { main: '/thesis.typ', files, viewType: 'sourceEditor', user: { name: 'Ada' } };
editor.setAttribute('settings', JSON.stringify({ 'files.panel': 'show' }));
document.body.append(editor);   // options are read now
```

=== Shadow DOM and theming <reference-embedding-theming>

- The element renders into an open shadow root: page CSS cannot break the editor, the editor's CSS cannot leak out.
- Colors are CSS custom properties on `.typst-editor` (`--te-accent`, `--te-border`, `--te-bg`, `--te-text`, …). They inherit into the shadow root: `typst-editor { --te-accent: rebeccapurple }`.
- Dark mode follows the page's `color-scheme`: light by default, dark under `color-scheme: dark`, the OS's under `color-scheme: light dark`. The setting `workbench.theme` overrides it.
- In dark mode the preview shows the pages inverted. The exported PDF is unchanged.
- `createTypstEditor` puts its styles into `document.head`, or into the shadow root its host lives in.

== createTypstEditor <reference-embedding-api>

```ts
import { createTypstEditor } from 'typst-editor';

const editor = createTypstEditor(host, {   // attach host to the document first, give it a height
  main: '/thesis.typ',
  files: {
    '/thesis.typ': '#include "chapters/intro.typ"\n#image("logo.png")',
    '/chapters/intro.typ': '= Introduction\n',
    '/logo.png': new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()),
  },
  user: { name: 'Ada' },
  allowFileChange: async (change) => confirmWithServer(change),
  onFilesChange: (change) => save(change),
});
```

The options: @reference-configuration-options.

The returned `TypstEditor`:

#table(
  columns: 2,
  [Member], [Meaning],
  [`files`], [Every file with its current content. Assigning replaces them all and recompiles.],
  [`source`], [The main file's text. Assigning is one minimal edit, reported as an `update`.],
  [`settings`], [The settings (@reference-configuration-setting).],
  [`activeFile`], [The path of the file shown.],
  [`open(path)`], [Shows `path`, if the project has it.],
  [`executeCommand(id, ...args)`], [Runs a command; resolves to its result, rejects for an unknown id or a failure.],
  [`exportPdf(options?)`], [The PDF (@reference-embedding-pdf).],
  [`dispose()`], [Removes the editor.],
)

=== Files <reference-embedding-files>

- Paths are absolute: they start with `/`, no `.` or `..` segments. Another key, or bytes for a `.typ` file, throws.
- `onFilesChange` is the one place to hear about changes: `{ kind: 'create' | 'update' | 'delete' | 'rename', path, content?, from? }`. It reports every `.typ` edit (`update` with the full text), the file panel's changes, the collaborators' changes and assignments to `files` or `source`.
- Assigning `files`: missing paths are deleted, new ones created, changed ones updated (open editors keep their cursor); each is reported. A map without the main file leaves its text as it is.
- Bytes reach the compile worker only when the `Uint8Array` changes: reuse the array for unchanged files.
- `#import "@preview/name:version"` works without configuration: the worker downloads the package from `packages.typst.org` on first use and keeps it in the Cache API.

```ts
editor.files = { ...editor.files, '/chapters/outro.typ': '= Outro' };
editor.open('/chapters/outro.typ');
```

=== PDF export <reference-embedding-pdf>

```ts
const final = await editor.exportPdf();                              // margin notes left out
const draft = await editor.exportPdf({ 'comments.include': true });  // margin notes kept
```

- Options are export options by id (@reference-configuration-pdf); the others keep their default (not the viewer's choice). An unknown id rejects.
- Rejects with the compiler's error when the document has errors.
- The same as `executeCommand('pdfExport.export', options)`.

=== Extensions <reference-embedding-extensions>

Every feature is an extension, the built-in ones too. `extensions` makes the list from the built-ins:

```ts
createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions, wordCount()] });                             // add
createTypstEditor(host, { extensions: (builtinExtensions) => builtinExtensions.filter((e) => e.id !== 'pdf-export') });          // leave out
createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions.filter((e) => e.id !== 'files'), myFiles] }); // replace
```

- Collaboration is not built in: add `collaboration(…)` with its connection (@reference-collaboration-server).
- The built-ins and their ids: @architecture-built-in-extensions. Writing one: @architecture-extensions-overview.
- On `<typst-editor>`, put `extensions` into `options` before the element connects.

=== Devtools <reference-embedding-devtools>

A right side panel ("Devtools" on the right rail) showing what the widget is made of while it runs. Always there; the setting `devtools.enabled: false` removes it (@reference-configuration-devtools).

```ts
createTypstEditor(host, { settings: { 'devtools.enabled': false } });
```

#table(
  columns: (auto, 1fr),
  table.header[Tab][Shows],
  [Document], [The shown file's ProseMirror document as a tree (@architecture-prosemirror-typst): each node with its source range, `box` for raw boxes and other atoms, marks, its text or kept `src`; the tooltip has positions, attributes and the source. The path to the selection is highlighted; a click selects the node's source.],
  [Contributions], [Every `register…` call and declared setting, in its contribution point's terms (`heading · priority 100 · parses Heading`, `Mod+Alt+KeyM → comments.addComment`, a panel by its side and order); by extension (activation order) or by contribution point, competitors in the order the host resolves them. `late`: made after activation; struck through: disposed. The tooltip: the arguments in full and the line that registered it.],
  [Events], [Every `onDid…` event of the extension context as it fires (the latest 300), its value pretty-printed as it was then; filter by name, Pause, Clear.],
)

- It sees only what any extension sees: `createTypstEditor` gives it the final list (the host's extensions included), and each extension's `activate` gets a context whose namespaces record every registration (and its `dispose`). The hosts keep no listing for it.
- It records while switched off too, so switched on later it shows everything since the start.
