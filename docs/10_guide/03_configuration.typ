= Configuration <guide-configuration>

Two kinds:

- *Settings:* values by id `<section>.<key>`, each declared by the extension of its feature (VS Code's settings). They can change while the editor runs.
- *Options:* what `createTypstEditor` takes once: files, callbacks, the user, the extensions (@guide-configuration-options).

== Setting values <guide-configuration-setting>

```ts
const editor = createTypstEditor(host, { settings: { 'files.panel': 'show' } });
editor.settings = { ...editor.settings, 'workbench.theme': 'dark' };   // replaces all; ids left out go back to their default
```

```html
<typst-editor settings='{"files.panel": "show", "pdfExport.download": false}'></typst-editor>
```

- `<typst-editor>`: the `settings` attribute (JSON object) goes over `options.settings`, id by id; it is read on connect and on every change. The `settings` property is the current settings; setting it replaces them.
- Unknown ids and values of the wrong type are ignored, with a console warning; the setting keeps its default.
- The editor follows a change at once.
- An extension reads a setting with `workspace.getConfiguration('<section>').get('<key>')` and hears changes through `workspace.onDidChangeConfiguration`; it declares its own in `contributes.configuration` (@extensions-overview-settings).

== Settings <guide-configuration-settings>

=== Appearance <guide-configuration-appearance>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`workbench.theme`], [`'light'`, `'dark'`, `'auto'`, `null` (`null`)], [Light or dark colors. `auto`: as the OS. `null`: as the page's CSS `color-scheme`. In dark mode the preview shows the pages inverted; the PDF stays as it is.],
  [`workbench.rightSidePanel`], [a side panel's id, `null` (`'preview'`)], [The panel the right side shows until the viewer picks one on its rail: `'preview'`, or an extension's right panel (e.g. `'devtools'`). `null`: the right side starts hidden, the editing area takes its room. An id no panel has: the right panel that asks to be shown, if any.],
  [`invisibles.show`], [`true`, `false` (unset)], [Whether the editors show invisible characters: spaces, non-breaking spaces, tabs, line breaks, paragraph ends (@guide-features-invisibles). Unset: what this viewer chose last ("Invisible characters" in the View menu, kept across visits), else `false`.],
)

Colors and dark mode in detail: @guide-embedding-theming.

=== Files <guide-configuration-files>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`files.panel`], [`'auto'`, `'show'`, `'hide'` (`'auto'`)], [`auto`: the file panel is open while the project has more than one file, else collapsed to its button (until someone opens or closes it). `show`: open. `hide`: no panel at all; files dropped beside the text are ignored.],
)

=== Writing <guide-configuration-writing>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`spellcheck.enabled`], [`true`, `false` (`true`)], [Whether the browser checks the spelling in the Visual editor, in the language of the document's `set text(lang: ..)` (@guide-features-spelling).],
)

=== Preview <guide-configuration-preview>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`previewSync.followCursor`], [`true`, `false` (unset)], [Whether the preview follows the cursor ("Follow cursor" in its toolbar). Unset: what this viewer chose last (kept across visits), else `true`.],
  [`previewSync.highlightSelection`], [`true`, `false` (`true`)], [Whether the text selected in the Visual or Source editor is shaded in the preview. Independent of "Follow cursor".],
)

=== PDF <guide-configuration-pdf>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`pdfExport.download`], [`true`, `false` (`true`)], [The preview's "Download PDF" button with the export options. `exportPdf` works either way.],
)

Export options, by id, for `editor.exportPdf(options)` and the command `pdfExport.export` (@guide-embedding-pdf). The "Download PDF" popover shows each as a checkbox:

#table(
  columns: 3,
  [Option], [Values (default)], [Effect],
  [`comments.include`], [`true`, `false` (`false`)], [Keep the margin notes as the preview shows them. `false`: the final version, notes removed (a range note keeps its text).],
)

=== Diagrams <guide-configuration-diagrams>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`diagrams.editorUrl`], [URL (`'https://embed.diagrams.net/'`)], [Where the draw.io editor comes from: diagrams.net, or your own installation of the drawio web app (Apache-2.0), e.g. for use without internet access. Embed mode and its parameters are added.],
)

=== Devtools <guide-configuration-devtools>

#table(
  columns: 3,
  [Setting], [Values (default)], [Effect],
  [`devtools.enabled`], [`true`, `false` (`true`)], [Whether the devtools panel is on the right rail: the shown document, every contribution, the events (@guide-embedding-devtools). They are recorded either way.],
)

== Options <guide-configuration-options>

`createTypstEditor(host, options)` (`TypstEditorOptions`), all optional. On `<typst-editor>`: the `options` property, set before the element connects (@guide-embedding-element).

#table(
  columns: 3,
  [Option], [Type (default)], [Meaning],
  [`files`], [`{ [path]: string | Uint8Array }` (`{}`)], [Every file by absolute path (@guide-embedding-files): Typst text as `string`, anything else (images, CSV, …) as `Uint8Array`. `@preview` packages need no entry.],
  [`main`], [path (`'/main.typ'`)], [The compiled file. Cannot be renamed or deleted.],
  [`source`], [`string`], [The main file's text; wins over `files[main]`. For single-file hosts. Without either, the main file starts empty.],
  [`viewType`], [`VISUAL_EDITOR` (`'visualEditor'`), `SOURCE_EDITOR` (`'sourceEditor'`), or another custom editor's view type (the Visual editor)], [The editor the main file opens in. Typst files keep opening in it until the user picks another tab.],
  [`user`], [`{ name, color? }` (name "Anonymous")], [Who signs comments, commits to GitLab and is shown to collaborators. `color`: their cursor color (CSS; default: made from the name).],
  [`settings`], [`{ [id]: value }` (`{}`)], [The settings (@guide-configuration-settings).],
  [`allowFileChange(change)`], [`boolean | Promise<boolean>` (all allowed)], [Veto for every create, rename, delete and upload the user asks for. `false`: refused, the user sees a message.],
  [`onFilesChange(change)`], [callback], [Every change to any file (@guide-embedding-files).],
  [`onOpen(path)`], [callback], [Another file is shown, e.g. to keep it in the URL.],
  [`extensions(builtinExtensions)`], [`(builtinExtensions) => extensions` (the built-ins)], [The extensions to run, made from the built-in ones: add, leave out, replace (@guide-embedding-extensions).],
)

Configured elsewhere:

- Collaboration: the connection passed to `collaboration(…)` (@guide-collaboration-connections).
- The collaboration server and its GitLab: environment variables (@guide-collaboration-server, @guide-collaboration-gitlab).
- Colors: CSS custom properties (@guide-embedding-theming).

== Example <guide-configuration-example>

A thesis portal: one project per student, saved on the portal's server, offline-capable diagram editor, no file deletes.

```ts
import { createTypstEditor } from 'typst-editor';

const editor = createTypstEditor(document.getElementById('thesis')!, {
  main: '/thesis.typ',
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
  onFilesChange: (change) => saveChange(studentId, change),
  onOpen: (path) => history.replaceState(null, '', `#${path}`),
});

const finalPdf = await editor.exportPdf({ 'comments.include': false });
```
