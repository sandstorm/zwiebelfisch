#import "/template.typ": unreviewed

= Embedding <configuration-embedding>

#unreviewed

You embed the editor as the element `<zwiebelfisch-editor>` or with `createEditor(host, options)`. Both take the same options (@configuration-options).

- *`<zwiebelfisch-editor>`* needs no glue code: the text inside the tag, settings as an attribute, changes as DOM events. Use it in plain HTML or any framework that renders elements.
- *`createEditor`* gives your code a handle (commands, `exportPdf`, `dispose`) and its events.

== A first editor <configuration-embedding-first-editor>

Run `mise run build:lib`, then copy `dist/lib` into your site (it is not on npm yet):

```html
<script type="module" src="/vendor/zwiebelfisch/zwiebelfisch.js"></script>

<zwiebelfisch-editor style="height: 600px">
  = Hello

  Some *Typst*.
</zwiebelfisch-editor>
```

Or from JavaScript, with the repository folder as dependency (its `package.json` exports it as `zwiebelfisch`):

```ts
import { createEditor } from 'zwiebelfisch';

const editor = createEditor(document.getElementById('editor')!, { source: '= Hello\n' });
editor.onDidChangeFiles((change) => save(change));
```

A complete page is `examples/plain-html/index.html`: serve the repository root and open `/examples/plain-html/`.

== The library build <configuration-embedding-library>

`mise run build:lib` writes `dist/lib`:

#table(
  columns: 2,
  [File], [Content],
  [`zwiebelfisch.js`], [The ES module, all dependencies bundled. Importing it registers `<zwiebelfisch-editor>`.],
  [`typst_engine_bg.<hash>.wasm`], [The Typst compiler (about 22 MB, 9 MB gzipped).],
  [`fonts/<name>.<hash>.otf`, `.ttf`], [Typst's default fonts, each downloaded on first use.],
  [other `*-<hash>.js`], [Chunks loaded on demand (e.g. collaboration).],
  [`assets/engine.worker-<hash>.js`], [The compile worker.],
  [`types/index.d.ts`], [TypeScript declarations.],
)

*Keep the folder together* and serve it from any path. Your server should send:

- the wasm as `Content-Type: application/wasm`;
- the hashed files with `Cache-Control: public, max-age=31536000, immutable`, and `zwiebelfisch.js` with `no-cache` and an `ETag`;
- compressed files if you like (gzip or brotli); the wasm shrinks most.
- *Content-Security-Policy:* `connect-src https://packages.typst.org` for `@preview` packages, and `frame-src https://embed.diagrams.net` (or your `diagrams.editorUrl`) for the diagram editor.

*Bundlers:* in Vite, add the package to `optimizeDeps.exclude`, as pre-bundling breaks the relative asset URLs. Webpack 5 and Rollup pick up the `new URL(…)` assets. Anything else: copy `dist/lib` and import `zwiebelfisch.js` from there.

== Custom element <configuration-embedding-element>

```html
<script type="module" src="/vendor/zwiebelfisch/zwiebelfisch.js"></script>

<zwiebelfisch-editor id="doc" settings='{"workbench.theme": "dark"}'>
  = Hello

  The initial source is the element's text, common indentation removed.
</zwiebelfisch-editor>

<script type="module">
  const doc = document.getElementById('doc');
  doc.addEventListener('change', (e) => save(e.detail.path, e.detail.content));
  doc.value = '= Replaced\n';   // no event for programmatic sets
</script>
```

#table(
  columns: 2,
  [Member], [Behaviour],
  [`options` property], [The options (@configuration-options-editor), read when the element connects.],
  [`settings` attribute], [The settings as JSON (@configuration-options-setting). A new value replaces the attribute's ids.],
  [`settings` property, `updateSettings(settings)`], [The current settings; merges, as `editor.updateSettings`.],
  [`value` property, attribute], [The main file's text. Setting it keeps cursor and undo history.],
  [`files` property], [Every file. Setting it replaces them all.],
  [`executeCommand(id, ...args)`], [Runs an extension's command.],
  [`exportPdf(options?)`], [The PDF as a `Blob` (@configuration-embedding-pdf).],
  [`change` event], [`detail: { path, content }` for every changed file, the collaborators' edits included; `content: null` when it is gone.],
  [`files-change` event], [`detail`: the `FileChange`, as `onDidChangeFiles` fires it.],
  [`main-file-change` event], [`detail: { path }`: another file became the main file, also by a collaborator.],
  [`open` event], [`detail: { path }`: another file is shown.],
)

- Set `options` *before appending the element*. Setting `value` or `files` dispatches no events.
- The element is `display: block` with a default height of `24rem`; set `height` on it.
- Another tag name: `defineEditorElement('my-editor')`.

```js
const editor = document.createElement('zwiebelfisch-editor');
editor.options = { mainFile: { path: '/thesis.typ' }, files, viewType: 'sourceEditor', user: { name: 'Ada' } };
editor.setAttribute('settings', JSON.stringify({ 'files.panel': 'show' }));
document.body.append(editor);   // options are read now
```

=== Shadow DOM and theming <configuration-embedding-theming>

The element renders into a shadow root, so your page's CSS and the editor's stay apart. Colors are CSS custom properties, which inherit into it:

```css
zwiebelfisch-editor { --zwf-accent: rebeccapurple; }   /* also --zwf-border, --zwf-bg, --zwf-text, … */
```

- *Dark mode follows the page's `color-scheme`*; the setting `workbench.theme` overrides it.
- In dark mode the preview shows the pages inverted. The exported PDF is unchanged.

== createEditor <configuration-embedding-api>

```ts
import { createEditor } from 'zwiebelfisch';

const editor = createEditor(host, {   // attach host to the document first, give it a height
  mainFile: { path: '/thesis.typ' },
  files: {
    '/thesis.typ': '#include "chapters/intro.typ"\n#image("logo.png")',
    '/chapters/intro.typ': '= Introduction\n',
    '/logo.png': new Uint8Array(await (await fetch('/logo.png')).arrayBuffer()),
  },
  user: { name: 'Ada' },
  allowFileChange: async (change) => confirmWithServer(change),
});
const saving = editor.onDidChangeFiles((change) => save(change));
```

It returns a `Editor`:

#table(
  columns: 2,
  [Member], [Meaning],
  [`files`], [Every file with its current content. Assigning replaces them all.],
  [`source`], [The main file's text. Assigning is one minimal edit.],
  [`settings`], [The current settings (@configuration-options-setting).],
  [`updateSettings(settings)`], [Merges settings; `undefined` resets an id to its default.],
  [`activeFile`], [The path of the file shown.],
  [`open(path)`], [Shows `path`.],
  [`executeCommand(id, ...args)`], [Runs a command and resolves to its result.],
  [`exportPdf(options?)`], [The PDF (@configuration-embedding-pdf).],
  [`dispose()`], [Removes the editor and drops every listener.],
)

=== Events <configuration-embedding-events>

The handle's events have VS Code's shape: `editor.onDid…(listener)` subscribes and returns a `Disposable`; `dispose()` on it unsubscribes. They fire only for changes after `createEditor` returned: the files you passed are not reported.

#table(
  columns: 2,
  [Event], [Fires with],
  [`onDidChangeFiles`], [Each `FileChange` (@configuration-embedding-files).],
  [`onDidChangeMainFile`], [The new main file's path: another file became the main file, also by a collaborator.],
  [`onDidChangeActiveFile`], [The path of the file now shown (`activeFile`), e.g. to keep it in the URL.],
)

=== Files <configuration-embedding-files>

```ts
editor.files = { ...editor.files, '/chapters/outro.typ': '= Outro' };
editor.open('/chapters/outro.typ');
```

- Paths are *absolute*: they start with `/`.
- *`onDidChangeFiles` is the one place to hear about changes*: `{ kind: 'create' | 'update' | 'delete' | 'rename', path, content?, from? }`. It covers edits, the file panel, collaborators and your own assignments.
- Reuse the `Uint8Array` of unchanged files: only a new array is sent to the compiler again.
- `#import "@preview/…"` works without configuration: packages are downloaded from `packages.typst.org` and cached.

=== PDF export <configuration-embedding-pdf>

```ts
const final = await editor.exportPdf();                              // margin notes left out
const draft = await editor.exportPdf({ 'comments.include': true });  // margin notes kept
```

It takes the export options (@configuration-options-pdf) and rejects when the document has errors. It is the same as `executeCommand('pdfExport.export', options)`.

=== Extensions <configuration-embedding-extensions>

Every feature is an extension, the built-in ones too. Make your list from the built-ins:

```ts
createEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions, wordCount()] });                             // add
createEditor(host, { extensions: (builtinExtensions) => builtinExtensions.filter((e) => e.id !== 'pdf-export') });          // leave out
createEditor(host, { extensions: (builtinExtensions) => [...builtinExtensions.filter((e) => e.id !== 'files'), myFiles] }); // replace
```

- Collaboration is not built in: add `collaboration(…)` (@configuration-collaboration-server).
- The built-ins and their ids: @architecture-extensions-built-in. Writing one: @architecture-extensions.

=== Devtools <configuration-embedding-devtools>

"Devtools" on the right rail shows what the editor is made of while it runs, as your browser's devtools do for a page. Switch it off with `devtools.enabled: false`.

- *Typst engine memory* on top: the engine's wasm memory only grows. A long document levels off; a value that keeps growing with every edit is a leak.
- *Document*: the shown file's ProseMirror document as a tree, each node with its source range (@architecture-prosemirror-typst).
- *Contributions*: every `register…` call and declared setting, by extension or by contribution point.
- *Events*: every `onDid…` event as it fires, while the panel is shown.

It sees only what any extension sees: each extension's context records its registrations.
