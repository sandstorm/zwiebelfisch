= Workbench API <architecture-workbench-api>

VS Code's namespaces and shapes: `commands`, `window`, `workspace`, `scm`, plus `workbench`, the editor's frame. Use `window` to talk to the user, never popups of your own.

== Commands <architecture-workbench-api-commands>

```ts
commands.registerCommand('wordCount.countFile', async (path: ProjectPath) => { … }); // Disposable
await commands.executeCommand<number>('wordCount.count');
commands.registerKeybinding('Mod+Alt+KeyW', 'wordCount.count');
```

- `registerCommand`: an id registered twice throws.
- `executeCommand<T>(id, ...args)` calls the handler synchronously (the user's gesture, selection and focus are as now) and resolves to its result. It rejects for an unknown id and when the handler throws or rejects.
- `registerKeybinding(key, command)`: modifiers and a `KeyboardEvent.code`, joined by `+` (`Mod` is Cmd on the Mac, else Ctrl). The modifiers must be exactly those (VS Code's matching): `Alt+Digit1` is not AltGr+1, `Ctrl+Minus` not Ctrl+Shift+Minus. The command runs without arguments, before any editor sees the key.
- Keys of commands for people are declared: `contributes.keybindings: [{ command, key, mac? }]` (VS Code's; `mac`: the Mac's key, if another). The workbench binds them and shows a command's key wherever it offers the command: search everywhere's command rows, menu entries, tab bar tooltips, and a side panel's rail tooltip (the key of `workbench.view.<id>`).
- The host runs commands too: `editor.executeCommand(id, ...args)`.
- Commands for people get a name in `contributes.commands` (VS Code's): search everywhere lists them while they are registered, as "Category: Title", and runs them without arguments. Declare only commands that work without any.

```ts
export const wordCount = (): TypstExtension => ({
  id: 'word-count',
  contributes: {
    commands: [{ command: 'wordCount.count', title: 'Count words', category: 'Word count' }],
    keybindings: [{ command: 'wordCount.count', key: 'Mod+Alt+KeyW' }],
  },
  activate({ commands, subscriptions }) { subscriptions.push(commands.registerCommand('wordCount.count', () => { … })); },
});
```

- The workbench's own: `workbench.action.searchEverywhere(text?)` opens search everywhere with `text` in its field (a prefix narrows it: `'>'`); `workbench.view.<id>` per side panel (VS Code's `workbench.view.explorer`) shows and focuses it, or hides it when it is shown and has the focus (the focus goes back where it was).

== Menus <architecture-workbench-api-menus>

A button is a menu entry: `workbench.registerMenuItem(menuId, item)`.

```ts
workbench.registerMenuItem('explorer/context', {
  command: 'wordCount.countFile',
  title: 'Count words',
  when: (context) => context.resourceKind === 'file',
});
```

`MenuItem`: `command`, `title?` (default: the command id), `icon?` (SVG markup in `currentColor`), `when?(context)`, `toggled?(context)`, `group?`, `order?`.

An entry that turns something on or off says whether it is on with `toggled` (VS Code's): the menu shows it as a checkbox entry (`menuitemcheckbox`) with a check mark while `toggled` holds.

```ts
workbench.registerMenuItem('view', {
  command: 'invisibles.toggle',
  title: 'Invisible characters',
  group: 'editor',
  toggled: () => shown,
});
```

#table(
  columns: 4,
  [Menu], [Where], [Context], [Command gets],
  [`editor/title`], [Buttons at the right end of the editing area's tab bar (shown for every file while it has tabs or buttons)], [`activeCustomEditorId` (the shown editor's view type, any editor), `resource`], [nothing],
  [`view`], [The View menu: "View ▾" after them, a popup; groups `editor` (how the editors show the text: "Invisible characters") and `preview` (the preview's view options, @architecture-source-editor-and-preview-view)], [as `editor/title`], [nothing],
  [`file/newFile`], ["New" in the file panel's header], [`view: 'files'`, `resource`, `resourceKind` (`'file'` | `'folder'`), `resourceIsMain`], [the row's path],
  [`explorer/context`], [A file panel row's context menu], [as `file/newFile`], [the row's path],
  [`help/row`], [A help row's context menu], [none], [the text the row inserts],
)

- Entries sort by `group` (`navigation` first, the others by name, a separator between groups), then `order`.
- `when` and `toggled` are asked each time the menu is shown.
- An editor or side panel shows a menu with `window.showContextMenu(menuId, { anchor, title, context, args })`: at a point (`{ x, y }`, a right click's) or below an element (a button), named `title`, with the entries whose `when` holds in `context`; the chosen entry's command gets `args`. Nothing shows while no entry applies. The file panel does this for `explorer/context` (right click, Shift+F10) and `file/newFile` ("New"), the help panel for `help/row`.
- `getMenuItems(menuId, context)` and `onDidChangeMenu` tell whether a menu has entries (the file panel hides "New" while `file/newFile` has none).

== Messages and quick input <architecture-workbench-api-messages>

#table(
  columns: 2,
  [Call], [Resolves to],
  [`showInformationMessage(message, ...items)`, `showWarningMessage`, `showErrorMessage`], [The item pressed (a string or `MessageItem { title }`), or `undefined` once closed],
  [`showInputBox({ title, prompt, value, valueSelection, placeHolder, validateInput })`], [The text, or `undefined` on Escape],
  [`showQuickPick(items, { title, placeHolder, canPickMany })`], [The `QuickPickItem` (or string) picked, the checked items with `canPickMany`, or `undefined`],
  [`showSaveDialog({ title, defaultUri, filters })`], [A new file's `ProjectPath`, or `undefined`],
  [`showContextMenu(menuId, { anchor, title, context, args })`], [Nothing: shows a contributed menu (@architecture-workbench-api-menus); the chosen entry's command runs],
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

== Search everywhere <architecture-workbench-api-search>

Double Shift anywhere in the widget, the magnifier on the left rail (order 15: after Files, before Help), or `workbench.action.searchEverywhere` open one quick pick over what every search provider finds, a group each: `window.registerSearchProvider(provider)`.

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
  [Styles], [`*`], [50], [`styles`: applies to the selection (Visual editor: as its menu; Source editor: `#name[selection]`), with the import],
  [Comments], [`!`], [60], [`comments`: notes by first message and authors; opens at the note, in the Visual editor its card],
  [Settings], [`:`], [70], [the workbench: booleans switch, `enum` settings ask for the value (for this widget, until the host sets the settings again)],
  [Text], [`%`], [90], [`textFiles`: lines of every Typst and text file holding the query (from 2 characters, at most 200); opens with the match selected],
)

== The frame <architecture-workbench-api-frame>

#table(
  columns: 2,
  [Member], [What],
  [`window.registerStatusBarItem(element, { alignment, priority })`], [`'left'` or `'right'`; within a side the higher `priority` further left],
  [`workbench.registerSidePanel(id, { label, icon, side, alignment, order })`], [A side panel and its rail button on `side` (`'left'`, the default, or `'right'`, after the built-in `preview`), in the rail's `alignment` group (`'top'`, the default, or `'bottom'`, at the rail's far end), by `order` there (lower first, default 0); returns `SidePanel` (`body`, `setDefault(open)`, `setAvailable`, `dismiss`, and VS Code's `WebviewView` `show(preserveFocus?)` (as the viewer's pick on the rail; focuses the first control, else the panel) and `visible` + `onDidChangeVisibility`: shown now, also as the narrow widget's overlay while open; never while unavailable, e.g. to work for the panel only while it is seen). One panel per side shows; ids are unique across both sides],
  [`workbench.registerEditorFrame({ top, bottom })`], [Elements before and after the shown file's editor: inside a Typst editor's content, scrolling with it; around any other editor's panel; one frame at a time],
  [`workbench.registerStyleSheet(css)`], [Your CSS where the widget renders (inside a `<typst-editor>`'s shadow root too); use the `--te-*` color tokens],
  [`workbench.ownerDocument`], [The document to create elements in],
  [`workbench.user`], [Who works here, as the host said; `undefined`: anonymous],
  [`workbench.isEditorFocused()`], [Whether the focus is in the editing area],
)

== Files and editors <architecture-workbench-api-files>

- *Read* through `project`: `files()`, `paths()`, `has(path)`, `document(path)` (a Typst file's `TypstDocument`, `.text`), `content(path)`, `onDidChangeFile` (an `Event<FileChange>`).
- *Change* through `workspace.applyEdit(change)`, never `project.apply`. It checks the project's rules, then the host's `allowFileChange`, and resolves to the reason it was refused, or `null`.
- `FileChange`: `{ kind: 'create' | 'update', path, content }`, `{ kind: 'delete', path }`, `{ kind: 'rename', path, from }`.
- *Show* with `workbench.open(path, { selection?, viewType? })` (`selection`: a `SourceRange` of a Typst file; `viewType`: the editor, e.g. `SOURCE_EDITOR`, `'sourceEditor'`); `window.activeFile` and `window.onDidChangeActiveFile` say what is shown.
- *The Typst editor*: `window.activeTextEditor` (`document`, `viewType`: the view it was shown in last, `VISUAL_EDITOR` or `SOURCE_EDITOR`, `selection` as a `SourceRange`, `revealRange(range)`, `insertSnippet(snippet)`: the Typst in place of the selection, as it is (no tab stops), the Visual editor reading it as Typst; `null` while another kind of file is shown) and `window.onDidChangeTextEditorSelection`.
- *Languages of files*: `languages.getLanguageId(path)` names the language of a file by the longest ending declared for it (`contributes.languages: [{ id: 'bibtex', extensions: ['.bib'] }]`, VS Code's; the workbench declares `typst` for `.typ`), undefined for none. An ending declared for two languages throws.
- *Dropped files*: `workbench.onDidDropFiles` gets the `File[]` dropped on the widget that no editor took.

== Custom editors <architecture-workbench-api-custom-editors>

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
  [`visualEditor` (`VISUAL_EDITOR`)], [`*.typ`: the Visual editor, retained], [default (registered first)],
  [`sourceEditor` (`SOURCE_EDITOR`)], [`*.typ`: the Source editor, retained], [default],
  [`diagrams.editor`], [`*.drawio.png`], [110],
  [`spreadsheets.editor`], [`*.ic`], [default],
  [`images.editor`], [`*.{png,jpg,jpeg,gif,svg,webp}`], [default],
  [`textFiles.editor`], [`*.{csv,json,yaml,yml,toml,xml,bib,txt,md,mmd}`], [default],
  [`files.file`], [`*`: any other file, read-only (name, size, type)], [`'fallback'`],
)

== Help <architecture-workbench-api-help>

The help panel (the built-in `help`) shows cheat sheets for the language of the shown file. A language's extension contributes its sheet: `languages.registerHelpProvider(selector, provider)`, with the `DocumentSelector` of document links (`{ language }`; none: every file).

```ts
languages.registerHelpProvider({ language: 'csv' }, {
  provideHelp: () => ({
    title: 'CSV',
    sections: [{ title: 'Rows', rows: [{ snippet: 'name,value', description: 'A header row', insert: 'name,value\n' }] }],
    links: [{ label: 'RFC 4180', href: 'https://www.rfc-editor.org/rfc/rfc4180' }],
  }),
});
```

- `HelpSheet`: `title`, `sections` (`title`, `rows`), `links?` (`label`, `href`: `http(s)` only, opened in a new tab). Plain data: the panel renders it, a list per section; no markup from providers.
- `HelpRow`: `snippet` (shown), `description`, `insert?` (what the row puts into the text; default: `snippet`).
- A row dragged into an editor carries its text as `text/plain` (the Source and text editors insert it where it is dropped); a row of a `typst` sheet also as `application/x-typst-snippet`, which the Visual editor reads as Typst (`insertTypst`). Enter inserts the selected row at the cursor of the shown Typst editor (`TextEditor.insertSnippet`); with another kind of file shown it is copied. A row's context menu is `help/row` (its commands get the row's text): "Insert at cursor" (`help.insertAtCursor`), "Copy" (`help.copy`); add entries with `workbench.registerMenuItem('help/row', …)`.
- `languages.provideHelp(languageId)`: every matching provider's sheet, for a view of its own.

The built-in sheets:

#table(
  columns: 3,
  [Language], [Sheet], [From],
  [`typst` (`.typ`)], [Typst basics], [`typst-language`],
  [`mermaid` (`.mmd`)], [Mermaid basics], [`mermaid` (the language: `text-files`)],
  [`ironcalc` (`.ic`)], [Spreadsheet formulas], [`spreadsheets`],
  [`bibtex` (`.bib`)], [BibTeX], [`text-files`],
)

== Known imports <architecture-workbench-api-known-imports>

Typst pasted into a file gets the imports it needs (the built-in `imports`). For text copied in the widget, the source file's imports travel along. For text from elsewhere, an extension says where the names of its constructs come from:

```ts
languages.registerKnownImport({ language: 'typst' }, { name: 'mermaid', module: '@preview/merman:0.4.0' });
```

- A pasted `mermaid(..)` in a file that neither defines nor imports `mermaid` adds `#import "@preview/merman:0.4.0": mermaid` at the top, or `mermaid` to an import of merman (any version) already there.
- `languages.provideKnownImports(languageId)`: every matching declaration, in registration order.

== Drop edits <architecture-workbench-api-drop-edits>

A project file dragged from the file panel, or a file from the desktop once uploaded, dropped into a Typst file (the Visual or the Source editor) becomes what an extension makes of it (VS Code's `DocumentDropEditProvider`):

```ts
languages.registerDocumentDropEditProvider({ language: 'typst' }, {
  provideDocumentDropEdits({ path, text }, position, file) {
    if (!file.endsWith('.mmd')) return null; // not ours: the next provider is asked
    return {
      insertText: `#figure(mermaid(read("${ProjectPath.referenceTo(path, file)}")), caption: [ ])`,
      additionalEdit: [/* the import, a TextChange of `text` before `position` */],
    };
  },
}, { priority: 110 });
```

- `document` is the text dropped into (`path`, `languageId`, `text`); `position` the source offset of the drop; `file` the dropped `ProjectPath`.
- The providers are asked by `priority` (default 100, higher first; equal: registration order); the first edit wins. Diagrams (110) win over images for `.drawio.png`, spreadsheets (110) over the Typst files' `#include` for `.ic.gen.typ`.
- `insertText` goes in at the drop position: the Source editor inserts it there, the Visual editor reads it as Typst (inline content into the text, blocks after the block there, as `insertTypst`). `additionalEdit` (changes of `text` before the drop, in its coordinates) goes into the same transaction: one undo step.
- Files from the desktop dropped into the text are uploaded first (to the folder the first provider by priority names with `provideUploadFolder(document, file)`, `file` being where it would go at the top, e.g. the images' folder for an image; else to the top of the project; a file of the same name and content is used as it is, another content gets the next free name, `name-2.ext`, …), then each is a drop of that project file, the first where they were dropped, the others after it. A refused upload is an error message. Files dropped elsewhere on the widget go to `workbench.onDidDropFiles`.

== Copy and paste <architecture-workbench-api-paste>

An extension takes part in copy and paste of a language's text with a paste edit provider (VS Code's `DocumentPasteEditProvider`). The editors do the paste: the Visual editor for Typst it reads as Typst, the Source editors for any paste.

```ts
languages.registerDocumentPasteEditProvider({ language: 'typst' }, {
  prepareDocumentPaste(document, copied, dataTransfer) {
    dataTransfer.setData('application/x-my-data', JSON.stringify(whatAPasteNeeds(document, copied)));
  },
  provideDocumentPasteEdits(document, ranges, text, dataTransfer) {
    return { insertText: text.replaceAll('<old>', '<new>'), additionalEdits: [{ from: 0, to: 0, insert: '#import "x.typ": y\n' }] };
  },
});
```

- `prepareDocumentPaste?(document, copied, dataTransfer)`: on a copy or cut from `document` (a `TextDocument`: `path`, `languageId`, `text`), after the editor has put the copied text (`copied`) on the clipboard; adds what a paste will need.
- `provideDocumentPasteEdits(document, ranges, text, dataTransfer)`: on a paste of `text` in place of `ranges` (the selection; `document` as it is before the paste). Returns a `DocumentPasteEdit`, or undefined for none: `insertText`, what goes in instead of `text`, and `additionalEdits?`, other `TextChange`s of the text before the paste. They go into the paste's transaction: one undo step.
- The providers of a paste run in registration order, each given the text the ones before left. Additional edits that overlap the pasted ranges or an earlier edit are dropped; one at the same place as a pasted range goes before the pasted text.
- The built-in ones: `imports` (the imports a paste needs), `labels` (new names for pasted labels the project has).

== File decorations <architecture-workbench-api-decorations>

`window.registerFileDecorationProvider({ provideFileDecoration(path), onDidChangeFileDecorations })` puts badges on file rows: `FileDecoration { badge?, tooltip?, color?, propagate? }` (`propagate`: also on the closed folders around the file). Several providers may decorate one file. Side panels that list files read `window.getFileDecorations(path)` and `window.getFileIcon(path)`.

== Settings and state <architecture-workbench-api-settings>

- `workspace.getConfiguration('<section>')`: `get(key, default?)`, `has(key)`, `inspect(key)` (`defaultValue`, `globalValue`: the host's).
- `workspace.onDidChangeConfiguration(event)`: `event.affectsConfiguration('<section>.<key>')` or a whole section.
- Declaring settings: @architecture-extensions-overview-settings.

=== Memento <architecture-workbench-api-state>

`globalState` and `workspaceState` are VS Code's `Memento`: `keys()`, `get(key, default?)`, `update(key, value)` (JSON-like; `undefined` removes). Each extension's values are apart from the others'.

#table(
  columns: 3,
  [Memento], [Kept], [Storage],
  [`globalState`], [For this viewer, across widgets and visits], [`localStorage`],
  [`workspaceState`], [For this project, during the browser session], [`sessionStorage`, under the main file's path],
)

What `get` returns comes from outside: check its shape. Without storage nothing is kept and nothing fails.

== Source controls <architecture-workbench-api-scm>

`scm.registerSourceControl(sourceControl)` offers somewhere the project can be committed; `scm.sourceControls` and `onDidChangeSourceControls` are for whoever shows them. The collaboration extension registers the GitLab branch behind a room; source-control shows it.

`SourceControl`: `id`, `label`, `defaultCommitMessage?`, `state` (`{ busy }`), `resourceStates?`, `statusBarCommands?`, `onDidChange`, `commit(message)`. The source control reports the outcome itself, through `window.show…Message`.

- `resourceStates`: the files with changes not committed, `{ path, decorations?: { badge?, tooltip?, color? } }`. Source-control shows the decorations in the file panel (also on closed folders); a deleted file has no row but counts.
- `statusBarCommands`: `{ title, tooltip?, backgroundColor?: 'warning' }` entries at the start of the status bar (`'warning'` stands out, for what needs the user). Unlike VS Code's, they name no command: a click commits (asks for the message).
