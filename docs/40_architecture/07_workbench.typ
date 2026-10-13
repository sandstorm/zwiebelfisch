#import "../template.typ": mermaid, unreviewed

= Workbench <architecture-workbench>

#unreviewed

`src/hosts/workbench/` is the widget's frame, the extension API's entry and the composition of all hosts; VS Code's namespaces live in `src/hosts/{commands,window,scm,languages,workspace}/`. The frame knows no feature by name: a feature is a `TypstExtension` (@architecture-extensions).

#figure(
  mermaid(read("../diagrams/workbench-composition.mmd"), width: 85%),
  caption: [What `createTypstEditor` composes.],
)

#table(
  columns: (auto, 1fr),
  table.header[Namespace][Offers],
  [`commands`], [commands by id, key bindings],
  [`window`], [messages, input box, quick pick, save dialog, `showContextMenu`, `withProgress`, search providers, status bar items, custom editors, file decorations, `activeFile`, `activeTextEditor`],
  [`scm`], [source controls (a duplicate id throws)],
  [`languages`], [document links, drop edits, paste edits, help providers, known imports by `DocumentSelector`; `getLanguageId`],
  [`workspace`], [`applyEdit`, settings],
  [`workbench`], [`open`, side panels, editor frame, menus, style sheets, dropped files, `user`],
)

Competing contributions are ordered as @architecture-extensions-rules says.

== Concepts <architecture-workbench-concepts>

- *Contributions are registered once*, at activation. Hosts apply them to every editor they create later.
- *Namespaces are hosts*: each is a module with an interface and a host class implementing it. No facade.
- *The frame*: `WorkbenchLayout` (a `SideBar` left and right, the editing area between, the status bar) and `EditorTabs`. One panel shows per side, sizes kept in the session; narrower than 720 px the left panel lies over the editing area.
- *The preview is the right side's built-in panel* (`preview`). It compiles whether shown or not.
- *`TypstEditors`* keeps a document's Visual and Source editor alive while hidden (`retainContextWhenHidden`), with cursor, scroll and undo history. One `TextEditor` per document spans both; the one shown gets the other's selection.
- *Editors and side panels never draw menus or popups of their own*: they talk to the user through `window`.

== Lifecycle <architecture-workbench-lifecycle>

+ The constructor makes every host and the frame and adds the CSS: the frame's, then each host's. Extensions add theirs at activation.
+ `activate(list)` declares every extension's settings, languages and commands and binds its keys (`contributes`), so they are readable during activation.
+ Extensions activate in list order (`ExtensionHost`; a duplicate id throws).
+ The main file is shown (in the editor `viewType` names) and compiled. Views are created later, on demand.
+ `dispose()` disposes the extensions in reverse order, then the frame.

== Loading <architecture-workbench-loading>

Nothing in the editing area waits for the engine.

#table(
  columns: (auto, 1fr),
  table.header[Arrived][Shown],
  [the JS], [the frame and the shown file's text, editable (`createTypstEditor` is synchronous)],
  [the worker, then the wasm (streamed)], [the preview's loader: "Loading the Typst compiler… 3.1 / 6.6 MB"],
  [the engine, compiling], ["Compiling…", then packages and fonts as they download],
  [the first pages], [the pages; raw boxes swap their code for their pictures],
)

- *The preview's progress* shows in its pane only; a compiler that cannot load or crashed becomes an error message.
- *`ProgressLocation.EditingArea`* (ours, for `window.withProgress`) puts a note over the editing area, which is `inert` until the task settles (collaboration: "Connecting to the room…").

== Extension API <architecture-workbench-api>

The shapes are VS Code's (#link("https://code.visualstudio.com/api/references/vscode-api")[VS Code API reference]): messages, `showInputBox`, `showQuickPick`, `Memento`, `getConfiguration`, menu items, providers. Here only what differs, and our own parts. Settings: @architecture-extensions-settings.

=== Commands and keys <architecture-workbench-commands>

```ts
// the word-count extension (@architecture-extensions-example), plus a key and a name for people:
contributes: {
  commands: [{ command: 'wordCount.count', title: 'Count words', category: 'Word count' }],
  keybindings: [{ command: 'wordCount.count', key: 'Mod+Alt+KeyW' }],
},
```

- *Keys* are a `KeyboardEvent.code` with exactly the modifiers named (`Mod` is ⌘ or Ctrl; Alt+1 is not AltGr+1), caught before any editor. `''` in `mac` / `win` / `linux` means no key there. The workbench shows each command's key in command rows, menus and tooltips.
- *`executeCommand`* rejects for an unknown id or a failing handler; `registerCommand` throws for an id registered twice. The host runs commands with `editor.executeCommand`.
- *Search everywhere runs `contributes.commands` without arguments*: declare only commands that work without any.
- *`workbench.view.<id>`*, one per side panel: shows and focuses it, or hides it when shown and focused. Extensions declare its key (`files` Alt+1, `search` Alt+3; ⌃1 / ⌃3 on the Mac).
- *`workbench.action.searchEverywhere(text?)`* opens search everywhere with `text` in its field (a prefix narrows it: `'>'`).
- *`editor.action.pasteAs({ kind? })`* switches the last paste, while its chip shows, to `kind`, or asks.

=== Menus <architecture-workbench-menus>

A button is a menu entry: `workbench.registerMenuItem(menuId, item)`; `window.showContextMenu(menuId, { anchor, title, context, args })` pops a menu up (its command gets `args`; nothing shows while no entry applies). An entry with `toggled?(context)` is a checkbox. `when` and `toggled` are asked each time the menu shows; `getMenuItems` and `onDidChangeMenu` tell whether a menu has entries (the file panel hides "New" without any).

#table(
  columns: 4,
  [Menu], [Where], [Context], [Command gets],
  [`editor/title`], [Buttons at the right end of the editing area's tab bar], [`activeCustomEditorId`, `resource`], [nothing],
  [`view`], [The View menu; groups `editor` ("Invisible characters") and `preview` (@architecture-preview-view)], [as `editor/title`], [nothing],
  [`file/newFile`], ["New" in the file panel's header], [`view: 'files'`, `resource`, `resourceKind`, `resourceIsMain`], [the row's path],
  [`explorer/context`], [A file panel row's context menu], [as `file/newFile`], [the row's path],
  [`help/row`], [A help row's context menu], [none], [the text the row inserts],
)

=== Messages and quick input <architecture-workbench-messages>

- *One input at a time:* a new input box or quick pick cancels the open one.
- *`showSaveDialog`* resolves to a new file's `ProjectPath`. It refuses existing names and names without a `filters` ending (`{ Diagrams: ['drawio.png'] }`); creating the file is your job (`workspace.applyEdit`).

=== Search everywhere <architecture-workbench-search>

One quick pick over every `SearchProvider` (ours), a group each, as IntelliJ's: opened by Shift twice, ⌘P, ⌘⇧O (`/`), ⌘⇧A (`>`), `workbench.action.searchEverywhere` or the left rail's button.

```ts
window.registerSearchProvider({
  id: 'wordCount.counts', label: 'Word counts', prefix: '$', order: 80,
  provideItems: (query, token) => project.paths().map((path) => ({
    label: ProjectPath.name(path),
    description: `${count(path)} words`,
    accept: () => workbench.open(path),
  })),
});
```

- *`provideItems(query, token)`* is asked on every change of the text after the prefix; when async, check `token.isCancellationRequested` between steps.
- *Return every candidate*: the search matches them fuzzily. Items with `highlights` were matched by the provider and show as given.
- *`accept()`* is called once the search is closed and the focus is back.
- *A `prefix` typed first* narrows the search to the providers with that prefix.

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

=== The frame <architecture-workbench-frame>

#table(
  columns: 2,
  [Member], [What],
  [`window.registerStatusBarItem(element, { alignment, priority })`], [`'left'` or `'right'`],
  [`workbench.registerSidePanel(id, { label, icon, side, alignment, order })`], [A side panel and its rail button; returns `SidePanel` (see the d.ts)],
  [`workbench.registerEditorFrame({ top, bottom })`], [Elements before and after the shown file's editor; one frame at a time],
  [`workbench.registerStyleSheet(css)`], [Your CSS where the widget renders (shadow root included); use the `--te-*` color tokens],
  [`workbench.ownerDocument`], [The document to create elements in],
  [`workbench.user`], [Who works here, as the host said or an extension set since; `undefined`: anonymous. Read it when needed],
  [`workbench.setUser(user)`], [Replaces it (the collaboration extension: the account signed in at the server)],
  [`workbench.isEditorFocused()`], [Whether the focus is in the editing area],
)

=== Files and editors <architecture-workbench-files>

- *Read* through `project` (`files()`, `paths()`, `has`, `document`, `content`, `onDidChangeFile`); *change* through `workspace.applyEdit(change)`, never `project.apply`. It checks the project, the host's `allowFileChange`, the project again, then applies, and resolves to the refusal in words or `null`. `FileChange`: @architecture-core-project.
- *Show* with `workbench.open(path, { selection?, viewType? })`; `window.activeFile` says what is shown.
- *`window.activeTextEditor`* is the Typst editor (`revealRange`, `insertSnippet`, …); `null` for other files.
- *`languages.getLanguageId(path)`* goes by the longest ending in `contributes.languages`.
- *Dropped files* no editor took go to `workbench.onDidDropFiles`.

=== Custom editors <architecture-workbench-custom-editors>

Every file opens in a custom editor, Typst files too: the Visual and Source editor are the built-in ones for `*.typ`, registered by `TypstEditors` before any extension, as VS Code's built-in text editor.

- *`filenamePattern`:* a case-insensitive glob over the name (`*.{png,jpg}`), over the path if it has a `/`.
- *`priority`:* a number, `'default'` (100), `'fallback'` (files no other editor opens) or `'option'` (only when chosen).
- *Tabs are "open with"*: a file several editors match gets a tab each (`displayName`); the one picked is remembered for later files.
- *Every open gets a new panel.* Store edits with `workspace.applyEdit`, pending ones in `panel.onDidDispose`; `panel.onDidRequestReveal(range)` follows `workbench.open(path, { selection })`.

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

=== Help <architecture-workbench-help>

`languages.registerHelpProvider(selector, { provideHelp })` (ours) gives the help panel a cheat sheet for the shown file's language: a plain-data `HelpSheet` (sections of rows `{ snippet, description, insert? }`, links), no markup. A row drags into an editor or inserts at the cursor with Enter; rows of a `typst` sheet drop into the Visual editor as Typst. `help/row` is the row's menu. Built-in sheets: `typst`, `mermaid`, `ironcalc`, `bibtex`.

=== Known imports <architecture-workbench-known-imports>

Pasted Typst gets the imports it needs (the built-in `imports`). For text from outside the widget, an extension says where a name comes from (ours):

```ts
languages.registerKnownImport({ language: 'typst' }, { name: 'mermaid', module: '@preview/merman:0.4.0' });
```

A pasted `mermaid(..)` then adds `#import "@preview/merman:0.4.0": mermaid`, or extends an import of merman already there.

=== Drop edits <architecture-workbench-drop-edits>

VS Code's `DocumentDropEditProvider`, for a file dropped into a Typst file. Return `null` to let the next provider answer; the first edit wins.

- *`insertText`* goes in at the drop; the Visual editor reads it as Typst. `additionalEdit` joins the same undo step.
- *Desktop files* are uploaded first, to the folder `provideUploadFolder(document, file)` names (else the project's top), then dropped as project files.

=== Copy and paste <architecture-workbench-paste>

VS Code's `DocumentPasteEditProvider`: `prepareDocumentPaste` on copy, `provideDocumentPasteEdits` for alternatives (each of a `kind`, shown in a "Paste as" chip), `resolveDocumentPasteEdit` for whatever goes in.

- *Kinds* are dot-separated (`typst` covers `typst.html`). The editors' own: `typst`, `typst.code`, `text.plain`, and the Visual editor's `typst.html`.
- *Order* (`sortPasteEdits`): providers' edits first, then the editors'; an edit goes after the kinds in its `yieldTo`; duplicates of earlier text drop out, and `text.plain` ("Plain text") takes the place of the first with its text, so a paste with formatting always offers it. ⌘⇧V prefers `text.plain`; the Source editors prefer `typst`.
- *`resolveDocumentPasteEdit`* of every provider runs on the edit that goes in, in registration order, whatever its kind. Built-in: `imports`, `labels` (new names for clashing labels). Overlapping additional edits are dropped.
- *Only providers whose `pasteMimeTypes` the clipboard has are asked*, all at paste time: the clipboard can't be read later.

=== File decorations <architecture-workbench-decorations>

Side panels that list files read `window.getFileDecorations(path)` and `window.getFileIcon(path)` (the custom editor's `icon`).

=== Settings and state <architecture-workbench-settings>

Settings are declared by extensions and the workbench (`workbench.theme`, `workbench.rightSidePanel`): @architecture-extensions-settings.

==== Memento <architecture-workbench-state>

`StorageMemento` behind `globalState` (this viewer, across widgets and visits: `localStorage`) and `workspaceState` (this project, during the browser session: `sessionStorage`). Each extension has its own values. Check the shape of what `get` returns: it comes from outside. Without storage nothing is kept and nothing fails.

=== Source controls <architecture-workbench-scm>

`scm.registerSourceControl(sourceControl)` (ours) offers a place to commit the project to; `scm.sourceControls` and `onDidChangeSourceControls` are for whoever shows them. Collaboration registers a room's GitLab branch; source-control shows it. `SourceControl`: see the d.ts.

- *`statusBarCommands`* sit at the start of the status bar; a click commits, `'warning'` makes an entry stand out.
- *The outcome* the source control reports itself, through `window.show…Message`.
