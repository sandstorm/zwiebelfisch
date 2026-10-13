= Workbench API <architecture-workbench-api>

VS Code's namespaces and shapes: `commands`, `window`, `workspace`, `scm`, plus `workbench`, the editor's frame. Talk to the user through `window`, never through popups of your own.

== Commands <architecture-workbench-api-commands>

```ts
commands.registerCommand('wordCount.countFile', async (path: ProjectPath) => { … }); // Disposable
await commands.executeCommand<number>('wordCount.count');
commands.registerKeybinding('Mod+Alt+KeyW', 'wordCount.count');
```

- *`registerCommand`* throws for an id registered twice.
- *`executeCommand<T>(id, ...args)`* runs the handler synchronously and resolves to its result. It rejects for an unknown id or a failing handler. The host runs commands with `editor.executeCommand(id, ...args)`.
- *`registerKeybinding(key, command, args?)`*: modifiers and a `KeyboardEvent.code`, joined by `+` (`Mod` is ⌘ or Ctrl), matched with exactly those modifiers (Alt+1 is not AltGr+1). It runs the command with `args`, before any editor sees the key.
- *`contributes.keybindings`*: `[{ command, key, mac?, win?, linux?, args? }]`, as VS Code's; `''` means no key on that platform. The workbench binds them and shows each command's key where it offers the command.
- *Commands for people* get a name in `contributes.commands`, as in VS Code. Search everywhere lists them as "Category: Title" and runs them without arguments, so declare only commands that work without any:

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

- *`workbench.action.searchEverywhere(text?)`* opens search everywhere with `text` in its field (a prefix narrows it: `'>'`).
- *`workbench.view.<id>`*: per side panel, shows and focuses it, or hides it when shown and focused. Search everywhere also opens with ⌘P, ⌘⇧O (`/`) and ⌘⇧A (`>`).
- *`editor.action.pasteAs({ kind? })`* switches the last paste, while its chip shows, to `kind` (`typst`, `text.plain`, `typst.code`, `typst.html`, `typst.markdown`), or asks.

== Menus <architecture-workbench-api-menus>

A button is a menu entry: `workbench.registerMenuItem(menuId, item)`.

```ts
workbench.registerMenuItem('explorer/context', {
  command: 'wordCount.countFile',
  title: 'Count words',
  when: (context) => context.resourceKind === 'file',
});
```

`MenuItem`: `command`, `title?` (default: the command id), `icon?` (SVG in `currentColor`), `when?(context)`, `toggled?(context)`, `group?`, `order?`. An entry with `toggled` shows as a checkbox entry, as in VS Code:

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
  [`editor/title`], [Buttons at the right end of the editing area's tab bar], [`activeCustomEditorId`, `resource`], [nothing],
  [`view`], [The View menu; groups `editor` ("Invisible characters") and `preview` (@architecture-source-editor-and-preview-view)], [as `editor/title`], [nothing],
  [`file/newFile`], ["New" in the file panel's header], [`view: 'files'`, `resource`, `resourceKind`, `resourceIsMain`], [the row's path],
  [`explorer/context`], [A file panel row's context menu], [as `file/newFile`], [the row's path],
  [`help/row`], [A help row's context menu], [none], [the text the row inserts],
)

- *Order:* by `group` (`navigation` first, then by name, separators between), then `order`. `when` and `toggled` are asked each time the menu shows.
- *Showing a menu:* `window.showContextMenu(menuId, { anchor, title, context, args })` opens it at a point or below an element. Its chosen command gets `args`; nothing shows while no entry applies.
- *`getMenuItems(menuId, context)`* and `onDidChangeMenu` tell whether a menu has entries (the file panel hides "New" without any).

== Messages and quick input <architecture-workbench-api-messages>

#table(
  columns: 2,
  [Call], [Resolves to],
  [`showInformationMessage(message, ...items)`, `showWarningMessage`, `showErrorMessage`], [The item pressed (a string or `MessageItem { title }`), or `undefined`],
  [`showInputBox({ title, prompt, value, valueSelection, placeHolder, validateInput })`], [The text, or `undefined` on Escape],
  [`showQuickPick(items, { title, placeHolder, canPickMany })`], [The item(s) picked, or `undefined`],
  [`showSaveDialog({ title, defaultUri, filters })`], [A new file's `ProjectPath`, or `undefined`],
  [`showContextMenu(menuId, { anchor, title, context, args })`], [Nothing: shows a contributed menu (@architecture-workbench-api-menus)],
  [`withProgress({ location, title }, (progress) => task)`], [What the task resolves to],
)

```ts
const choice = await window.showInformationMessage(`${path}: ${words} words`, 'Open');
if (choice === 'Open') workbench.open(path);
```

- *Messages* are not modal. An information message without items closes by itself.
- *One input at a time:* a new input box or quick pick cancels the open one.
- *`showSaveDialog`* refuses existing names and names without a `filters` ending (`{ Diagrams: ['drawio.png'] }`). Creating the file is your job (`workspace.applyEdit`).
- *`withProgress`:* `ProgressLocation.Window` puts a spinner into the status bar, `ProgressLocation.EditingArea` blocks the editing area until the task settles.

== Search everywhere <architecture-workbench-api-search>

Shift twice, the field-over-list button on the left rail, ⌘P or `workbench.action.searchEverywhere` open one quick pick over every search provider, a group each: `window.registerSearchProvider(provider)`.

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

- *`provideItems(query, token)`* is asked on every change of the text after the prefix. When it is async, check `token.isCancellationRequested` between steps.
- *Matching:* return every candidate; the search matches them fuzzily. Items with `highlights` were matched by the provider and show as given.
- *`SearchItem`:* a `QuickPickItem` plus `accept()`, called once the search is closed and the focus is back.
- *`prefix`* typed first narrows the search to the providers with that prefix. Groups sort by `order` (default 100).

#table(
  columns: 4,
  [Group], [Prefix], [Order], [From],
  [Files], [`/`], [10], [`files`: opens],
  [Headings], [`#`], [20], [`headings`: opens at the heading],
  [Labels], [`@`], [30], [`labels`: labels except figures' and bibliography keys],
  [Figures], [`@`], [31], [`figures`: figures, tables and listings by caption],
  [Commands], [`>`], [40], [the workbench: `contributes.commands`; runs],
  [Styles], [`*`], [50], [`styles`: applies to the selection],
  [Comments], [`!`], [60], [`comments`: opens at the note],
  [Settings], [`:`], [70], [the workbench: switches booleans, asks for `enum` values],
  [Text], [`%`], [90], [`textFiles`: lines of Typst and text files; opens with the match selected],
)

== The frame <architecture-workbench-api-frame>

#table(
  columns: 2,
  [Member], [What],
  [`window.registerStatusBarItem(element, { alignment, priority })`], [`'left'` or `'right'`; a higher `priority` sits further left],
  [`workbench.registerSidePanel(id, { label, icon, side, alignment, order })`], [A side panel and its rail button; returns `SidePanel` (`body`, `setDefault(open)`, `setAvailable`, `dismiss`, `show(preserveFocus?)`, `visible`, `onDidChangeVisibility`). One panel per side shows],
  [`workbench.registerEditorFrame({ top, bottom })`], [Elements before and after the shown file's editor; one frame at a time],
  [`workbench.registerStyleSheet(css)`], [Your CSS where the widget renders (shadow root included); use the `--te-*` color tokens],
  [`workbench.ownerDocument`], [The document to create elements in],
  [`workbench.user`], [Who works here, as the host said; `undefined`: anonymous],
  [`workbench.isEditorFocused()`], [Whether the focus is in the editing area],
)

== Files and editors <architecture-workbench-api-files>

- *Read* through `project`: `files()`, `paths()`, `has(path)`, `document(path)`, `content(path)`, `onDidChangeFile`.
- *Change* through `workspace.applyEdit(change)`, never `project.apply`. It checks the project's rules and the host's `allowFileChange`, and resolves to the refusal reason or `null`.
- *`FileChange`:* `{ kind: 'create' | 'update', path, content }`, `{ kind: 'delete', path }`, `{ kind: 'rename', path, from }`.
- *Show* with `workbench.open(path, { selection?, viewType? })`. `window.activeFile` and `onDidChangeActiveFile` say what is shown.
- *The Typst editor:* `window.activeTextEditor` (`document`, `viewType`, `selection`, `revealRange(range)`, `insertSnippet(snippet)`; `null` for other files) and `onDidChangeTextEditorSelection`.
- *Languages:* `languages.getLanguageId(path)`, by the longest ending in `contributes.languages` (`[{ id: 'bibtex', extensions: ['.bib'] }]`, as in VS Code).
- *Dropped files* no editor took go to `workbench.onDidDropFiles`.

== Custom editors <architecture-workbench-api-custom-editors>

Every file opens in a custom editor, as in VS Code, Typst files too: `window.registerCustomEditorProvider(viewType, provider, options)`.

```ts
window.registerCustomEditorProvider('csv.table', {
  resolveCustomEditor(document, panel) {
    const text = typeof document.content === 'string' ? document.content : new TextDecoder().decode(document.content);
    panel.element.append(renderTable(text)); // yours
  },
}, { filenamePattern: '*.csv', displayName: 'Table', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="M2 3h12v10H2zM2 7h12M6 3v10"/></svg>' });
```

- *`filenamePattern`:* a case-insensitive glob over the name (`*.{png,jpg}`), over the path if it has a `/`.
- *`priority`:* a number, `'default'` (100), `'fallback'` (files no other editor opens) or `'option'` (only when chosen).
- *Which editor opens:* the one the user chose last, else the highest `priority`, then the most specific pattern (`*.drawio.png` over `*.png`).
- *`displayName`* is its tab: a file several editors match gets a tab each. `icon` shows in the file panel.
- *Reveal:* `panel.onDidRequestReveal(range)` asks the editor to select a range after `workbench.open(path, { selection })`.
- *Panels:* every open gets a new one. Store edits with `workspace.applyEdit`, pending ones in `panel.onDidDispose`. `retainContextWhenHidden: true` keeps the panel while hidden.

#table(
  columns: 3,
  [View type], [Pattern], [Priority],
  [`visualEditor` (`VISUAL_EDITOR`)], [`*.typ`, retained], [default (registered first)],
  [`sourceEditor` (`SOURCE_EDITOR`)], [`*.typ`, retained], [default],
  [`diagrams.editor`], [`*.drawio.png`], [110],
  [`spreadsheets.editor`], [`*.ic`], [default],
  [`images.editor`], [`*.{png,jpg,jpeg,gif,svg,webp}`], [default],
  [`textFiles.editor`], [`*.{csv,json,yaml,yml,toml,xml,bib,txt,md,mmd}`], [default],
  [`files.file`], [`*`: read-only name, size and type], [`'fallback'`],
)

== Help <architecture-workbench-api-help>

The help panel shows a cheat sheet for the language of the shown file: `languages.registerHelpProvider(selector, provider)`.

```ts
languages.registerHelpProvider({ language: 'csv' }, {
  provideHelp: () => ({
    title: 'CSV',
    sections: [{ title: 'Rows', rows: [{ snippet: 'name,value', description: 'A header row', insert: 'name,value\n' }] }],
    links: [{ label: 'RFC 4180', href: 'https://www.rfc-editor.org/rfc/rfc4180' }],
  }),
});
```

- *Plain data:* the panel renders the `HelpSheet`; providers give no markup. `insert` defaults to `snippet`.
- *Using a row:* drag it into an editor, or press Enter to insert it at the cursor. Rows of a `typst` sheet drop into the Visual editor as Typst.
- *Row menu:* `help/row` has "Insert at cursor" and "Copy"; add your own with `workbench.registerMenuItem('help/row', …)`.
- *`languages.provideHelp(languageId)`* returns every matching sheet, for a view of your own.

Built-in sheets: `typst` (`typst-language`), `mermaid` (`mermaid`), `ironcalc` (`spreadsheets`), `bibtex` (`text-files`).

== Known imports <architecture-workbench-api-known-imports>

Pasted Typst gets the imports it needs (the built-in `imports`). For text from outside the widget, say where a name comes from:

```ts
languages.registerKnownImport({ language: 'typst' }, { name: 'mermaid', module: '@preview/merman:0.4.0' });
```

- A pasted `mermaid(..)` then adds `#import "@preview/merman:0.4.0": mermaid`, or extends an import of merman that is already there.
- `languages.provideKnownImports(languageId)` returns every matching declaration.

== Drop edits <architecture-workbench-api-drop-edits>

A file dropped into a Typst file becomes what an extension makes of it, as VS Code's `DocumentDropEditProvider`:

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

- *Order:* by `priority` (default 100, higher first); the first edit wins. Diagrams and spreadsheets use 110.
- *`insertText`* goes in at the drop; the Visual editor reads it as Typst. `additionalEdit` joins the same undo step.
- *Desktop files* are uploaded first, to the folder `provideUploadFolder(document, file)` names (else the project's top), then dropped as project files.

== Copy and paste <architecture-workbench-api-paste>

Take part in copy and paste with a paste edit provider, in the shape of VS Code's `DocumentPasteEditProvider`: offer other ways a paste can go in (alternative edits, each of a `kind`), or resolve whatever goes in. The editors offer the alternatives in a "Paste as" chip.

```ts
// offers a kind: Markdown on the clipboard as Typst
languages.registerDocumentPasteEditProvider({ language: 'typst' }, {
  provideDocumentPasteEdits(document, ranges, dataTransfer) {
    const text = dataTransfer.getData('text/plain');
    return looksLikeMarkdown(text) ? [{ kind: 'typst.markdown', title: 'Markdown', insertText: markdownToTypst(text), yieldTo: ['typst.code'] }] : [];
  },
}, { providedPasteEditKinds: ['typst.markdown'], pasteMimeTypes: ['text/plain'] });

// resolves every paste: what it needs from the copy, what goes in besides
languages.registerDocumentPasteEditProvider({ language: 'typst' }, {
  prepareDocumentPaste(document, copied, dataTransfer) {
    dataTransfer.setData('application/x-my-data', JSON.stringify(whatAPasteNeeds(document, copied)));
  },
  resolveDocumentPasteEdit(edit, document, ranges, dataTransfer) {
    return { ...edit, additionalEdit: [...(edit.additionalEdit ?? []), { from: 0, to: 0, insert: '#import "x.typ": y\n' }] };
  },
}, { providedPasteEditKinds: [] });
```

- *`prepareDocumentPaste?`* runs on copy or cut and adds what a paste will need.
- *`provideDocumentPasteEdits?`* returns alternatives `{ title, kind, insertText, additionalEdit?, yieldTo? }`. Register with `{ providedPasteEditKinds, pasteMimeTypes? }`; only providers whose mime types the clipboard has are asked.
- *Kinds* are dot-separated (`typst` covers `typst.html`). The editors' own: `typst`, `typst.code`, `text.plain`, and the Visual editor's `typst.html`.
- *Order* (`sortPasteEdits`): providers' edits first, then the editors'; an edit goes after the kinds in its `yieldTo`; duplicates of earlier text drop out. ⌘⇧V prefers `text.plain`; the Source editors prefer `typst`.
- *`resolveDocumentPasteEdit?`* of every provider runs on the edit that goes in, in registration order: a post-step whatever the kind. Built-in: `imports` (the imports a paste needs), `labels` (new names for clashing labels). Overlapping additional edits are dropped.
- All edits are asked and resolved at paste time; the clipboard can't be read later.

== File decorations <architecture-workbench-api-decorations>

`window.registerFileDecorationProvider({ provideFileDecoration(path), onDidChangeFileDecorations })` puts badges on file rows: `FileDecoration { badge?, tooltip?, color?, propagate? }`. Side panels that list files read `window.getFileDecorations(path)` and `window.getFileIcon(path)`.

== Settings and state <architecture-workbench-api-settings>

- `workspace.getConfiguration('<section>')`: `get(key, default?)`, `has(key)`, `inspect(key)`.
- `workspace.onDidChangeConfiguration(event)`: `event.affectsConfiguration('<section>.<key>')`.
- Declaring settings: @architecture-extensions-overview-settings.

=== Memento <architecture-workbench-api-state>

`globalState` and `workspaceState` are VS Code's `Memento`: `keys()`, `get(key, default?)`, `update(key, value)`. Each extension has its own values.

#table(
  columns: 3,
  [Memento], [Kept], [Storage],
  [`globalState`], [For this viewer, across widgets and visits], [`localStorage`],
  [`workspaceState`], [For this project, during the browser session], [`sessionStorage`],
)

Check the shape of what `get` returns: it comes from outside. Without storage nothing is kept and nothing fails.

== Source controls <architecture-workbench-api-scm>

`scm.registerSourceControl(sourceControl)` offers a place to commit the project to; `scm.sourceControls` and `onDidChangeSourceControls` are for whoever shows them. The collaboration extension registers a room's GitLab branch; source-control shows it.

`SourceControl`: `id`, `label`, `defaultCommitMessage?`, `state` (`{ busy }`), `resourceStates?`, `statusBarCommands?`, `onDidChange`, `commit(message)`.

- *`resourceStates`:* the uncommitted files, with decorations for the file panel.
- *`statusBarCommands`:* entries at the start of the status bar. A click commits; `'warning'` makes an entry stand out.
- *Outcome:* the source control reports it itself, through `window.show…Message`.
