= Workbench API <extensions-workbench-api>

VS Code's namespaces and shapes: `commands`, `window`, `workspace`, `scm`, plus `workbench`, the editor's frame. Use `window` to talk to the user, never popups of your own.

== Commands <extensions-workbench-api-commands>

```ts
commands.registerCommand('wordCount.countFile', async (path: ProjectPath) => { … }); // Disposable
await commands.executeCommand<number>('wordCount.count');
commands.registerKeybinding('Mod+Alt+KeyW', 'wordCount.count');
```

- `registerCommand`: an id registered twice throws.
- `executeCommand<T>(id, ...args)` calls the handler synchronously (the user's gesture, selection and focus are as now) and resolves to its result. It rejects for an unknown id and when the handler throws or rejects.
- `registerKeybinding(key, command)`: modifiers and a `KeyboardEvent.code`, joined by `+` (`Mod` is Ctrl or Cmd). The command runs without arguments, before any editor sees the key.
- The host runs commands too: `editor.executeCommand(id, ...args)`.

== Menus <extensions-workbench-api-menus>

A button is a menu entry: `workbench.registerMenuItem(menuId, item)`.

```ts
workbench.registerMenuItem('explorer/context', {
  command: 'wordCount.countFile',
  title: 'Count words',
  when: (context) => context.resourceKind === 'file',
});
```

`MenuItem`: `command`, `title?` (default: the command id), `icon?` (SVG markup in `currentColor`), `when?(context)`, `group?`, `order?`.

#table(
  columns: 4,
  [Menu], [Where], [Context], [Command gets],
  [`editor/title`], [The editing area's tab bar, shown while the file has several editors], [`editorMode` (`'visual'` | `'source'`; undefined for other editors), `resource`], [nothing],
  [`file/newFile`], ["New" in the file panel's header], [`view: 'files'`, `resource`, `resourceKind` (`'file'` | `'folder'`), `resourceIsMain`], [the row's path],
  [`explorer/context`], [A file panel row's context menu], [as `file/newFile`], [the row's path],
)

- Entries sort by `group` (`navigation` first, the others by name, a separator between groups), then `order`.
- `when` is asked each time the menu is shown.
- A view that shows a menu of its own reads `getMenuItems(menuId, context)` and follows `onDidChangeMenu`. The file panel does this for `file/newFile` and `explorer/context`.

== Messages and quick input <extensions-workbench-api-messages>

#table(
  columns: 2,
  [Call], [Resolves to],
  [`showInformationMessage(message, ...items)`, `showWarningMessage`, `showErrorMessage`], [The item pressed (a string or `MessageItem { title }`), or `undefined` once closed],
  [`showInputBox({ title, prompt, value, valueSelection, placeHolder, validateInput })`], [The text, or `undefined` on Escape],
  [`showQuickPick(items, { title, placeHolder, canPickMany })`], [The `QuickPickItem` (or string) picked, the checked items with `canPickMany`, or `undefined`],
  [`showSaveDialog({ title, defaultUri, filters })`], [A new file's `ProjectPath`, or `undefined`],
)

- Messages are not modal. An information message without items closes by itself; warnings and errors stay.
- One input box or quick pick at a time: a new one cancels the open one.
- `showSaveDialog` refuses names of existing files and names without one of the `filters` endings (`{ Diagrams: ['drawio.png'] }`; `'*'`: any). Creating the file is the caller's job (`workspace.applyEdit`).
- `defaultUri`: a file or folder starts the name in that folder; a path the project has no file at, with one of the `filters` endings, is proposed as the name (`ProjectPath.unique(path, exists)` makes it free: `table-2.ic`).

```ts
const choice = await window.showInformationMessage(`${path}: ${words} words`, 'Open');
if (choice === 'Open') workbench.open(path);
```

== The frame <extensions-workbench-api-frame>

#table(
  columns: 2,
  [Member], [What],
  [`window.registerStatusBarItem(element, { alignment, priority })`], [`'left'` or `'right'`; within a side the higher `priority` further left],
  [`workbench.registerSidePanel(id, { label, icon, order })`], [A side panel and its rail button; returns `SidePanel` (`body`, `setDefault(open)`, `setAvailable`, `dismiss`)],
  [`workbench.registerEditorFrame({ top, bottom })`], [Elements before and after the shown Typst file's content, scrolling with it; one frame at a time],
  [`workbench.registerStyleSheet(css)`], [Your CSS where the widget renders (inside a `<typst-editor>`'s shadow root too); use the `--te-*` color tokens],
  [`workbench.ownerDocument`], [The document to create elements in],
  [`workbench.user`], [Who works here, as the host said; `undefined`: anonymous],
  [`workbench.isEditorFocused()`], [Whether the focus is in the editing area],
)

== Files and editors <extensions-workbench-api-files>

- *Read* through `project`: `files()`, `paths()`, `has(path)`, `document(path)` (a Typst file's `TypstDocument`, `.text`), `content(path)`, `onDidChangeFile` (an `Event<FileChange>`).
- *Change* through `workspace.applyEdit(change)`, never `project.apply`. It checks the project's rules, then the host's `allowFileChange`, and resolves to the reason it was refused, or `null`.
- `FileChange`: `{ kind: 'create' | 'update', path, content }`, `{ kind: 'delete', path }`, `{ kind: 'rename', path, from }`.
- *Show* with `workbench.open(path, { selection?, viewType? })` (`selection`: a `SourceRange` of a Typst file; `viewType`: the editor, e.g. `'sourceView.editor'`); `window.activeFile` and `window.onDidChangeActiveFile` say what is shown.
- *The Typst editor*: `window.activeTextEditor` (`document`, `mode`, `selection` as a `SourceRange`, `revealRange(range)`; `null` while another kind of file is shown) and `window.onDidChangeTextEditorSelection`.
- *Dropped files*: `workbench.onDidDropFiles` gets the `File[]` dropped on the widget that no view took.

== Custom editors <extensions-workbench-api-custom-editors>

Every file opens in a custom editor (VS Code's), Typst files too: `window.registerCustomEditorProvider(viewType, provider, options)`.

```ts
window.registerCustomEditorProvider('csv.table', {
  resolveCustomEditor(document, panel) {
    const text = typeof document.content === 'string' ? document.content : new TextDecoder().decode(document.content);
    panel.element.append(renderTable(text)); // yours
  },
}, { filenamePattern: '*.csv', displayName: 'Table', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 3h12v10H2zM2 7h12M6 3v10"/></svg>' });
```

- `viewType`: `<extension>.<name>`, unique.
- `displayName`: its tab. A file several editors match gets a tab per editor, best first (the editing area's "open with").
- `filenamePattern`: a case-insensitive glob over the file name (`*.csv`, `*.{png,jpg}`), over the path from the root if it has a `/`.
- `priority`: a number (only orders editors), `'default'` (100), `'fallback'` (only files no other editor opens, without a tab) or `'option'` (only when chosen).
- Of the editors matching a file: the one the user chose last (a tab, or `workbench.open(path, { viewType })`), else the highest `priority`, then the most specific pattern (more literal characters: `*.drawio.png` over `*.png` over `*`; `*.csv` over `*.{csv,json,…}`), then the first registered.
- `icon`: SVG markup, 16×16 view box, strokes in `currentColor`; the file panel shows it on the rows of the files it opens.
- Every open gets a new panel. Fill `panel.element`; store edits with `workspace.applyEdit({ kind: 'update', path, content })`; store what is pending in `panel.onDidDispose`.
- `retainContextWhenHidden: true` keeps a file's panel, hidden, while something else is shown (`panel.visible`, `panel.onDidChangeViewState`), and shows it again when the file opens in this editor again; it follows a rename and is disposed when the file is deleted.

The built-in ones, to beat or to leave alone:

#table(
  columns: 3,
  [View type], [Pattern], [Priority],
  [`visualView.editor`], [`*.typ`: the Visual view, retained], [default (registered first)],
  [`sourceView.editor`], [`*.typ`: the Source view, retained], [default],
  [`diagrams.editor`], [`*.drawio.png`], [110],
  [`spreadsheets.editor`], [`*.ic`], [default],
  [`images.preview`], [`*.{png,jpg,jpeg,gif,svg,webp}`], [default],
  [`textFiles.editor`], [`*.{csv,json,yaml,yml,toml,xml,bib,txt,md,mmd}`], [default],
  [`files.file`], [`*`: any other file, read-only (name, size, type)], [`'fallback'`],
)

== File decorations <extensions-workbench-api-decorations>

`window.registerFileDecorationProvider({ provideFileDecoration(path), onDidChangeFileDecorations })` puts badges on file rows: `FileDecoration { badge?, tooltip?, color?, propagate? }` (`propagate`: also on the closed folders around the file). Several providers may decorate one file. Views that list files read `window.getFileDecorations(path)` and `window.getFileIcon(path)`.

== Settings and state <extensions-workbench-api-settings>

- `workspace.getConfiguration('<section>')`: `get(key, default?)`, `has(key)`, `inspect(key)` (`defaultValue`, `globalValue`: the host's).
- `workspace.onDidChangeConfiguration(event)`: `event.affectsConfiguration('<section>.<key>')` or a whole section.
- Declaring settings: @extensions-overview-settings.

=== Memento <extensions-workbench-api-state>

`globalState` and `workspaceState` are VS Code's `Memento`: `keys()`, `get(key, default?)`, `update(key, value)` (JSON-like; `undefined` removes). Each extension's values are apart from the others'.

#table(
  columns: 3,
  [Memento], [Kept], [Storage],
  [`globalState`], [For this viewer, across widgets and visits], [`localStorage`],
  [`workspaceState`], [For this project, during the browser session], [`sessionStorage`, under the main file's path],
)

What `get` returns comes from outside: check its shape. Without storage nothing is kept and nothing fails.

== Source controls <extensions-workbench-api-scm>

`scm.registerSourceControl(sourceControl)` offers somewhere the project can be committed; `scm.sourceControls` and `onDidChangeSourceControls` are for whoever shows them. The collaboration extension registers the GitLab branch behind a room; source-control shows it.

`SourceControl`: `id`, `label`, `defaultCommitMessage?`, `state` (`{ busy }`), `resourceStates?`, `statusBarCommands?`, `onDidChange`, `commit(message)`. The source control reports the outcome itself, through `window.show…Message`.

- `resourceStates`: the files with changes not committed, `{ path, decorations?: { badge?, tooltip?, color? } }`. Source-control shows the decorations in the file panel (also on closed folders); a deleted file has no row but counts.
- `statusBarCommands`: `{ title, tooltip?, backgroundColor?: 'warning' }` entries at the start of the status bar (`'warning'` stands out, for what needs the user). Unlike VS Code's, they name no command: a click commits (asks for the message).
