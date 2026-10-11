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
- Commands for people get a name in `contributes.commands` (VS Code's): search everywhere lists them while they are registered, as "Category: Title", and runs them without arguments. Declare only commands that work without any.

```ts
export const wordCount = (): TypstExtension => ({
  id: 'word-count',
  contributes: { commands: [{ command: 'wordCount.count', title: 'Count words', category: 'Word count' }] },
  activate({ commands, subscriptions }) { subscriptions.push(commands.registerCommand('wordCount.count', () => { … })); },
});
```

- The workbench's own: `workbench.action.searchEverywhere(text?)` opens search everywhere with `text` in its field (a prefix narrows it: `'>'`).

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
  [`editor/title`], [The editing area's tab bar, shown while the file has several editors], [`activeCustomEditorId` (the shown editor's view type, any editor), `resource`], [nothing],
  [`file/newFile`], ["New" in the file panel's header], [`view: 'files'`, `resource`, `resourceKind` (`'file'` | `'folder'`), `resourceIsMain`], [the row's path],
  [`explorer/context`], [A file panel row's context menu], [as `file/newFile`], [the row's path],
)

- Entries sort by `group` (`navigation` first, the others by name, a separator between groups), then `order`.
- `when` is asked each time the menu is shown.
- A view shows a menu with `window.showContextMenu(menuId, { anchor, title, context, args })`: at a point (`{ x, y }`, a right click's) or below an element (a button), named `title`, with the entries whose `when` holds in `context`; the chosen entry's command gets `args`. Nothing shows while no entry applies. The file panel does this for `explorer/context` (right click, Shift+F10) and `file/newFile` ("New").
- `getMenuItems(menuId, context)` and `onDidChangeMenu` tell whether a menu has entries (the file panel hides "New" while `file/newFile` has none).

== Messages and quick input <extensions-workbench-api-messages>

#table(
  columns: 2,
  [Call], [Resolves to],
  [`showInformationMessage(message, ...items)`, `showWarningMessage`, `showErrorMessage`], [The item pressed (a string or `MessageItem { title }`), or `undefined` once closed],
  [`showInputBox({ title, prompt, value, valueSelection, placeHolder, validateInput })`], [The text, or `undefined` on Escape],
  [`showQuickPick(items, { title, placeHolder, canPickMany })`], [The `QuickPickItem` (or string) picked, the checked items with `canPickMany`, or `undefined`],
  [`showSaveDialog({ title, defaultUri, filters })`], [A new file's `ProjectPath`, or `undefined`],
  [`showContextMenu(menuId, { anchor, title, context, args })`], [Nothing: shows a contributed menu (@extensions-workbench-api-menus); the chosen entry's command runs],
  [`withProgress({ location, title }, (progress) => task)`], [What the task resolves to; shown until it settles],
)

- Messages are not modal. An information message without items closes by itself; warnings and errors stay.
- One input box or quick pick (search everywhere included) at a time: a new one cancels the open one.
- `showSaveDialog` refuses names of existing files and names without one of the `filters` endings (`{ Diagrams: ['drawio.png'] }`; `'*'`: any). Creating the file is the caller's job (`workspace.applyEdit`).
- `withProgress`: `ProgressLocation.Window` puts a spinner with "title: message" into the status bar; `ProgressLocation.EditingArea` lays a note over the editing area, which takes no input until the task settles. `progress.report({ message, increment })`: `increment` is percent done since the last report.
- `defaultUri`: a file or folder starts the name in that folder; a path the project has no file at, with one of the `filters` endings, is proposed as the name (`ProjectPath.unique(path, exists)` makes it free: `table-2.ic`).

```ts
const choice = await window.showInformationMessage(`${path}: ${words} words`, 'Open');
if (choice === 'Open') workbench.open(path);
```

== Search everywhere <extensions-workbench-api-search>

Double Shift anywhere in the widget, the magnifier at the bottom of the left rail, or `workbench.action.searchEverywhere` open one quick pick over what every search provider finds, a group each: `window.registerSearchProvider(provider)`.

```ts
window.registerSearchProvider({
  id: 'wordCount.counts',
  label: 'Word counts',
  prefix: '$',
  order: 80,
  provideItems: (query, token) => project.paths().map((path) => ({
    label: ProjectPath.name(path),
    description: `${count(path)} words`,
    accept: () => workbench.open(path),
  })),
});
```

- `provideItems(query, token)`: asked again whenever the text changes; `query` is the text after the prefix, trimmed. May return a Promise: check `token.isCancellationRequested` (VS Code's `CancellationToken`) between steps; a cancelled round's results are dropped.
- Items without `highlights` (most providers): return every candidate; the search matches them fuzzily against `label`, else `description`, and marks the match. Items with `highlights` were matched by the provider (text search) and show as given, in its order.
- `SearchItem`: a `QuickPickItem` (`label`, `description`, `detail`) plus `accept()`, called once the search is closed and the focus is back where it was, still within the key press or click.
- `prefix` typed first narrows the search to the providers with that prefix; they then show up to 100 results, otherwise 5 per group (the heading says how many more). The line below the list names every prefix.
- Groups by `order` (lower first, default 100), then `id`.

The built-in providers:

#table(
  columns: 4,
  [Group], [Prefix], [Order], [From],
  [Files], [`/`], [10], [`files`: name and path; opens],
  [Headings], [`#`], [20], [`headings`: every Typst file's; opens at the heading],
  [Labels], [`@`], [30], [`labels`: labels of headings, equations and the rest, not of figures or bibliography keys; opens at the label],
  [Figures], [`@`], [31], [`figures`: figures, tables and listings by caption (and label); opens at the figure],
  [Commands], [`>`], [40], [the workbench: `contributes.commands`; runs],
  [Styles], [`*`], [50], [`styles`: applies to the selection (Visual view: as its menu; Source view: `#name[selection]`), with the import],
  [Comments], [`!`], [60], [`comments`: notes by first message and authors; opens at the note, in the Visual view its card],
  [Settings], [`:`], [70], [the workbench: booleans switch, `enum` settings ask for the value (for this widget, until the host sets the settings again)],
  [Text], [`%`], [90], [`textFiles`: lines of every Typst and text file holding the query (from 2 characters, at most 200); opens with the match selected],
)

== The frame <extensions-workbench-api-frame>

#table(
  columns: 2,
  [Member], [What],
  [`window.registerStatusBarItem(element, { alignment, priority })`], [`'left'` or `'right'`; within a side the higher `priority` further left],
  [`workbench.registerSidePanel(id, { label, icon, side, order })`], [A side panel and its rail button on `side` (`'left'`, the default, or `'right'`, after the built-in `preview`); returns `SidePanel` (`body`, `setDefault(open)`, `setAvailable`, `dismiss`). One panel per side shows; ids are unique across both sides],
  [`workbench.registerEditorFrame({ top, bottom })`], [Elements before and after the shown file's editor: inside a Typst view's content, scrolling with it; around any other editor's panel; one frame at a time],
  [`workbench.registerStyleSheet(css)`], [Your CSS where the widget renders (inside a `<typst-editor>`'s shadow root too); use the `--te-*` color tokens],
  [`workbench.ownerDocument`], [The document to create elements in],
  [`workbench.user`], [Who works here, as the host said; `undefined`: anonymous],
  [`workbench.isEditorFocused()`], [Whether the focus is in the editing area],
)

== Files and editors <extensions-workbench-api-files>

- *Read* through `project`: `files()`, `paths()`, `has(path)`, `document(path)` (a Typst file's `TypstDocument`, `.text`), `content(path)`, `onDidChangeFile` (an `Event<FileChange>`).
- *Change* through `workspace.applyEdit(change)`, never `project.apply`. It checks the project's rules, then the host's `allowFileChange`, and resolves to the reason it was refused, or `null`.
- `FileChange`: `{ kind: 'create' | 'update', path, content }`, `{ kind: 'delete', path }`, `{ kind: 'rename', path, from }`.
- *Show* with `workbench.open(path, { selection?, viewType? })` (`selection`: a `SourceRange` of a Typst file; `viewType`: the editor, e.g. `SOURCE_VIEW_TYPE`, `'sourceView.editor'`); `window.activeFile` and `window.onDidChangeActiveFile` say what is shown.
- *The Typst editor*: `window.activeTextEditor` (`document`, `viewType`: the view it was shown in last, `VISUAL_VIEW_TYPE` or `SOURCE_VIEW_TYPE`, `selection` as a `SourceRange`, `revealRange(range)`; `null` while another kind of file is shown) and `window.onDidChangeTextEditorSelection`.
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
  [`visualView.editor` (`VISUAL_VIEW_TYPE`)], [`*.typ`: the Visual view, retained], [default (registered first)],
  [`sourceView.editor` (`SOURCE_VIEW_TYPE`)], [`*.typ`: the Source view, retained], [default],
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
