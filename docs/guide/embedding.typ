= Embedding <guide-embedding>

Two ways in, same options:

- `<typst-editor>`: a custom element in a shadow root (@guide-embedding-element).
- `createTypstEditor(host, options)`: a function that fills a host element (@guide-embedding-api).

== The library build <guide-embedding-library>

`mise run build:lib` writes `dist/lib`:

#table(
  columns: 2,
  [File], [Content],
  [`typst-editor.js`], [ES module, all dependencies bundled. Importing it registers `<typst-editor>`.],
  [`typst_engine_bg.wasm`], [The Typst compiler and PDF export (about 22 MB, 9 MB gzipped).],
  [`*.otf`, `*.ttf`], [Typst's default fonts, each downloaded when a document first uses it.],
  [other `*.js`], [Chunks loaded on demand (e.g. collaboration).],
  [`assets/engine.worker-*.js`], [The compile worker.],
  [`types/index.d.ts`], [TypeScript declarations.],
)

- Keep the folder together; serve it from any path. The module finds its files through `new URL(…, import.meta.url)`.
- Serve the wasm as `application/wasm`, so it compiles while it streams.
- Importing without a DOM (SSR) is safe: nothing is registered.
- Content-Security-Policy: `connect-src https://packages.typst.org` for `@preview` packages; the diagram editor is an iframe from `https://embed.diagrams.net` (setting `diagrams.editorUrl`).

Bundlers:

- *Vite:* add the package to `optimizeDeps.exclude`. Pre-bundling moves the module into `node_modules/.vite` and breaks the relative asset URLs.
- *Webpack 5, Rollup:* pick up the `new URL(…)` assets and copy them.
- *Anything else:* copy `dist/lib` as it is and import `typst-editor.js` from there.

== Custom element <guide-embedding-element>

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
  [`options` property], [`Partial<TypstEditorOptions>` (@guide-embedding-api), read when the element connects. Set it before appending the element. Its `onFilesChange` / `onOpen` run as well as the events.],
  [`settings` attribute], [JSON object of settings by id (@guide-embedding-settings), over `options.settings` id by id. Read on connect and on every change. Not a JSON object: ignored, with a console warning.],
  [`settings` property], [The current settings. Setting it replaces them.],
  [`value` property, attribute], [The main file's text. Setting it is one minimal edit: cursor and undo history survive. The property is not reflected to the attribute.],
  [`files` property], [Every file, the main file included. Setting it replaces them all.],
  [`executeCommand(id, ...args)`], [Runs an extension's command; rejects while not connected.],
  [`exportPdf(options?)`], [The PDF as a `Blob` (@guide-embedding-pdf).],
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
editor.options = { main: '/thesis.typ', files, mode: 'source', user: { name: 'Ada' } };
editor.setAttribute('settings', JSON.stringify({ 'files.panel': 'show' }));
document.body.append(editor);   // options are read now
```

=== Shadow DOM and theming <guide-embedding-theming>

- The element renders into an open shadow root: page CSS cannot break the editor, the editor's CSS cannot leak out.
- Colors are CSS custom properties on `.typst-editor` (`--te-accent`, `--te-border`, `--te-bg`, `--te-text`, …). They inherit into the shadow root: `typst-editor { --te-accent: rebeccapurple }`.
- Dark mode follows the page's `color-scheme`: light by default, dark under `color-scheme: dark`, the OS's under `color-scheme: light dark`. The setting `workbench.theme` overrides it.
- In dark mode the preview shows the pages inverted. The exported PDF is unchanged.
- `createTypstEditor` puts its styles into `document.head`, or into the shadow root its host lives in.

== createTypstEditor <guide-embedding-api>

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

Options (`TypstEditorOptions`), all optional:

#table(
  columns: 2,
  [Option], [Meaning],
  [`files`], [Every file by absolute path: Typst text as `string`, anything else (images, CSV, …) as `Uint8Array`. `@preview` packages need no entry.],
  [`main`], [The compiled file (default `/main.typ`). Cannot be renamed or deleted.],
  [`source`], [The main file's text; wins over `files[main]`. For single-file hosts.],
  [`mode`], [`'visual'` (default) or `'source'`: the view shown first.],
  [`allowFileChange(change)`], [Veto for every create, rename, delete and upload the user asks for; may be async. `false`: refused, the user sees a message.],
  [`onFilesChange(change)`], [Every change to any file (@guide-embedding-files).],
  [`onOpen(path)`], [Another file is shown, e.g. to keep it in the URL.],
  [`user`], [`{ name, color? }`: who signs comments, commits to GitLab, and is shown to collaborators. Without it: "Anonymous".],
  [`settings`], [Settings by id (@guide-embedding-settings).],
  [`extensions(builtinExtensions)`], [The extensions to run, made from the built-in ones (@guide-embedding-extensions).],
)

The returned `TypstEditor`:

#table(
  columns: 2,
  [Member], [Meaning],
  [`files`], [Every file with its current content. Assigning replaces them all and recompiles.],
  [`source`], [The main file's text. Assigning is one minimal edit, reported as an `update`.],
  [`settings`], [The host's settings. Assigning replaces them; ids left out go back to their default.],
  [`activeFile`], [The path of the file shown.],
  [`open(path)`], [Shows `path`, if the project has it.],
  [`executeCommand(id, ...args)`], [Runs a command; resolves to its result, rejects for an unknown id or a failure.],
  [`exportPdf(options?)`], [The PDF (@guide-embedding-pdf).],
  [`dispose()`], [Removes the editor.],
)

=== Files <guide-embedding-files>

- Paths are absolute: they start with `/`, no `.` or `..` segments. Another key, or bytes for a `.typ` file, throws.
- `onFilesChange` is the one place to hear about changes: `{ kind: 'create' | 'update' | 'delete' | 'rename', path, content?, from? }`. It reports every `.typ` edit (`update` with the full text), the file panel's changes, the collaborators' changes and assignments to `files` or `source`.
- Assigning `files`: missing paths are deleted, new ones created, changed ones updated (open views keep their cursor); each is reported. A map without the main file leaves its text as it is.
- Bytes reach the compile worker only when the `Uint8Array` changes: reuse the array for unchanged files.
- `#import "@preview/name:version"` works without configuration: the worker downloads the package from `packages.typst.org` on first use and keeps it in the Cache API.

```ts
editor.files = { ...editor.files, '/chapters/outro.typ': '= Outro' };
editor.open('/chapters/outro.typ');
```

=== Settings <guide-embedding-settings>

Each feature's extension declares its settings by id `<section>.<key>` (VS Code's settings). Unknown ids and values of the wrong type are ignored, with a console warning. The widget follows changes at once.

```ts
const editor = createTypstEditor(host, { settings: { 'pdfExport.download': false, 'files.panel': 'show' } });
editor.settings = { ...editor.settings, 'workbench.theme': 'dark' };
```

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`workbench.theme`], [`'light'`, `'dark'`, `'auto'` (`null`)], [Light or dark colors; `auto`: the OS's; `null`: the page's `color-scheme`.],
  [`files.panel`], [`'auto'`, `'show'`, `'hide'` (`'auto'`)], [File panel open with more than one file / always / never (dropped files are then ignored).],
  [`previewSync.followCursor`], [`true`, `false` (unset)], [Whether the preview follows the cursor. Unset: the viewer's last choice, else `true`.],
  [`pdfExport.download`], [`true`, `false` (`true`)], [The preview's "Download PDF" button. `exportPdf` works either way.],
  [`diagrams.editorUrl`], [URL (`'https://embed.diagrams.net/'`)], [Where the diagram editor comes from, e.g. your own drawio installation for offline use.],
)

Extensions declare their own settings the same way (@extensions-overview-settings).

=== PDF export <guide-embedding-pdf>

```ts
const final = await editor.exportPdf();                              // margin notes left out
const draft = await editor.exportPdf({ 'comments.include': true });  // margin notes kept
```

- Options are export options by id; the others keep their default (not the viewer's choice). An unknown id rejects.
- Rejects with the compiler's error when the document has errors.
- The same as `executeCommand('pdfExport.export', options)`.

=== Extensions <guide-embedding-extensions>

Every feature is an extension, the built-in ones too. `extensions` makes the list from the built-ins:

```ts
createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions, wordCount()] });                             // add
createTypstEditor(host, { extensions: (builtinExtensions) => builtinExtensions.filter((e) => e.id !== 'pdf-export') });          // leave out
createTypstEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions.filter((e) => e.id !== 'files'), myFiles] }); // replace
```

- Collaboration is not built in: add `collaboration(…)` with its connection (@guide-collaboration).
- The built-ins and their ids: @architecture-built-in-extensions. Writing one: @extensions-overview.
- On `<typst-editor>`, put `extensions` into `options` before the element connects.
