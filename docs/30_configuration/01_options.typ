#import "/template.typ": unreviewed

= Configuration options <configuration-options>

#unreviewed

`createEditor(host, options)` and `<zwiebelfisch-editor>` take one options object. Only its `settings` can change later, with `editor.updateSettings`. `files` and `source` are the starting content; from then on it changes through the user's edits and `editor.files`.

== Options <configuration-options-editor>

All optional (type `EditorOptions`). On `<zwiebelfisch-editor>`, set the `options` property before the element connects (@configuration-embedding-element).

#table(
  columns: 3,
  [Option], [Type (default)], [Meaning],
  [`files`], [`{ [path]: string | Uint8Array }` (`{}`)], [Every file by absolute path (@configuration-embedding-files): Typst as `string`, images and data as `Uint8Array`.],
  [`mainFile`], [`{ path, locked? }` (`{ path: '/main.typ' }`)], [The compiled file. It cannot be renamed or deleted. Users can make another `.typ` file the main one, for this page only; a collaboration room shares it (not a GitLab room). `locked: true` keeps it fixed, also against the room.],
  [`source`], [`string`], [The main file's text, for single-file hosts. Wins over `files[mainFile.path]`.],
  [`viewType`], [`'visualEditor'` (default), `'sourceEditor'`], [The editor Typst files open in, until the user picks the other tab.],
  [`user`], [`{ name, color? }` (`'Anonymous'`)], [Who signs comments and commits, as collaborators see them (on a collaboration server: the name signed in there). `color` is their cursor color.],
  [`settings`], [`{ [id]: value }` (`{}`)], [The settings, by id (@configuration-options-settings). The only option that can change later (@configuration-options-setting).],
  [`allowFileChange(change)`], [`boolean | Promise<boolean>` (all allowed)], [A veto on every create, rename, delete and upload, e.g. to refuse image uploads.],
  [`extensions(builtinExtensions)`], [`(builtinExtensions) => extensions` (the built-ins)], [Add, leave out or replace extensions (@configuration-embedding-extensions).],
)

Configured elsewhere:

- Collaboration: the connection passed to `collaboration(…)` (@configuration-collaboration-server-connections).
- The server and its GitLab: environment variables (@configuration-collaboration-server-running, @configuration-gitlab-integration).
- Colors: CSS custom properties (@configuration-embedding-theming).

== Changing settings <configuration-options-setting>

```ts
const editor = createEditor(host, { settings: { 'files.panel': 'show' } });
editor.updateSettings({ 'workbench.theme': 'dark' });   // merges: other ids keep their value
editor.updateSettings({ 'files.panel': undefined });    // back to the default
```

```html
<zwiebelfisch-editor settings='{"files.panel": "show", "pdfExport.download": false}'></zwiebelfisch-editor>
```

- The editor *follows a change at once*. `editor.settings` is the current values.
- On `<zwiebelfisch-editor>`, the attribute is read on connect and on every change; a new value replaces the attribute's own ids. `element.updateSettings` merges, as on the editor.
- Unknown ids and values of the wrong type are ignored with a console warning.
- An extension reads a setting with `workspace.getConfiguration('<section>').get('<key>')` and declares its own in `contributes.configuration` (@architecture-extensions-settings).

=== All settings <configuration-options-settings>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`workbench.theme`], [`'light'`, `'dark'`, `'auto'`, `null` (`null`)], [Light or dark colors. `auto` follows the OS, `null` the page's CSS `color-scheme` (@configuration-embedding-theming).],
  [`workbench.rightSidePanel`], [a side panel's id, `null` (`'preview'`)], [What the right side shows first, e.g. `'preview'` or `'devtools'`. `null`: the right side starts hidden.],
  [`files.panel`], [`'auto'`, `'show'`, `'hide'` (`'auto'`)], [`auto`: the file panel is open while the project has more than one file. `hide`: no file panel at all.],
  [`invisibles.show`], [`true`, `false` (unset)], [Whether the editors show spaces, tabs and line breaks. Unset: the viewer's own choice in the View menu.],
  [`previewSync.followCursor`], [`true`, `false` (unset)], [Whether the preview scrolls to the cursor. Unset: the viewer's own choice, else `true`.],
  [`previewSync.highlightSelection`], [`true`, `false` (`true`)], [Whether the text selected in the editor is shaded in the preview.],
  [`pdfExport.download`], [`true`, `false` (`true`)], [The preview's "Download PDF" button. `exportPdf` works either way.],
  [`diagrams.editorUrl`], [URL (`'https://embed.diagrams.net/'`)], [Where the draw.io editor comes from, e.g. your own drawio installation for use without internet access.],
  [`devtools.enabled`], [`true`, `false` (`true`)], [Whether the devtools panel is on the right rail (@configuration-embedding-devtools).],
)

== PDF export options <configuration-options-pdf>

`editor.exportPdf(options)` and the command `pdfExport.export` take export options by id. The "Download PDF" popover shows each as a checkbox.

#table(
  columns: 3,
  [Option], [Values (default)], [Effect],
  [`comments.include`], [`true`, `false` (`false`)], [Keep the margin notes. `false`: the final version, without notes.],
)

== Example <configuration-options-example>

A thesis portal: one project per student, saved on the portal's server, its own diagram editor, no file deletes.

```ts
import { createEditor } from 'zwiebelfisch';

const editor = createEditor(document.getElementById('thesis')!, {
  mainFile: { path: '/thesis.typ', locked: true },
  files: await loadProject(studentId),            // { '/thesis.typ': '…', '/figures/setup.png': Uint8Array, … }
  user: { name: 'Ada Example', color: '#1d5fa8' },
  settings: {
    'workbench.theme': 'auto',
    'files.panel': 'show',
    'previewSync.followCursor': true,
    'pdfExport.download': true,
    'diagrams.editorUrl': 'https://drawio.uni.example/',
  },
  allowFileChange: (change) => change.kind !== 'delete',
});
editor.onDidChangeFiles((change) => saveChange(studentId, change));
editor.onDidChangeActiveFile((path) => history.replaceState(null, '', `#${path}`));

const finalPdf = await editor.exportPdf({ 'comments.include': false });
```
