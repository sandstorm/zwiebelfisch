#import "../template.typ": mermaid, unreviewed

= Window <architecture-window>

#unreviewed

Everything the user sees and interacts with (VS Code's `window`), in `src/hosts/window/`; beside it `src/hosts/{commands,languages,scm}/`, and `workspace` in the extension host (`src/hosts/extension-host/workspace/`). The window imports only `commands` and core and knows no feature by name; features are extensions (@architecture-extensions-host).

#figure(
  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),
  caption: [The frame: a rail and a side panel per side, the editing area between, the status bar below.],
)

== Concepts <architecture-window-concepts>

- *Namespaces are hosts:* each is a module with an interface and a host class implementing it; no facade. The shapes are VS Code's (#link("https://code.visualstudio.com/api/references/vscode-api")[API reference]); the doc comments say where they differ.
- *Contributions are registered once*, at activation; the hosts apply them to every editor they create later. Competing ones are ordered as @architecture-extensions-rules says.
- *Editors and side panels never draw menus or popups of their own:* they talk to the user through `window`, so one input, one menu and one message area serve all.
- *One side panel per side.* Sizes and the panels picked are kept for the session; narrower than 720 px the left panel lies over the editing area. The preview is the right side's built-in panel (`preview`) and compiles whether shown or not.

== Loading <architecture-window-loading>

Nothing in the editing area waits for the engine (`createEditor` is synchronous). In order of arrival:

+ *the JS*: frame and text, editable;
+ *worker and wasm*: "Loading the Typst compiler… 3.1 / 6.6 MB";
+ *the engine*: "Compiling…", packages, fonts;
+ *the first pages*: raw boxes get their pictures.

- The preview's progress (`previewProgress`) shows in its pane only; a compiler that cannot load or crashed becomes an error message.
- `ProgressLocation.EditingArea` (ours) makes the editing area `inert` under a note until a task settles (collaboration: "Connecting to the room…").

== Extension API <architecture-window-api>

`WindowApi` (`src/hosts/window/window.ts`) is VS Code's `window`: it tells and asks (messages, input boxes, quick picks, context menus, progress), fills places (side panels, status bar, custom editors, the editor frame, menus, file decorations, search providers, style sheets), opens files and follows the file and Typst editor the user works in.

=== Commands and keys <architecture-window-commands>

- *Keys are caught before any editor*, so a binding means the same everywhere; an extension only declares them (`contributes.keybindings`), never listens itself.
- *Search everywhere runs `contributes.commands` without arguments:* declare only commands that work without any.
- *Commands other extensions rely on:* `workbench.view.<id>` per side panel (the window's; extensions declare its key: `files` Alt+1, `search` Alt+3, ⌃1 / ⌃3 on the Mac); `workbench.action.searchEverywhere(text?)` (`searchEverywhere`); `editor.action.pasteAs({ kind? })` (`clipboard`).

=== Menus <architecture-window-menus>

Every button is a menu entry (`MenuItem`: a command, shown `when`, `enabled`, `toggled`, placed by `group` and `order`): `registerMenuItem` adds it, `showContextMenu` or a host shows the menu.

#table(
  columns: 4,
  table.header[Menu][Where][Context][Command gets],
  [`editor/title`], [the right end of the editing area's tab bar], [`activeCustomEditorId`, `resource`], [nothing],
  [`view`], [the View menu; groups `editor`, `preview` (@architecture-preview-view)], [as `editor/title`], [nothing],
  [`preview/title`], [the preview's toolbar (@architecture-preview-extensions)], [`previewRenderer`], [the context],
  [`file/newFile`], ["New" in the file panel's header], [`view`, `resource`, `resourceKind`, `resourceIsMain`], [the row's path],
  [`explorer/context`], [a file panel row's context menu], [as `file/newFile`], [the row's path],
  [`help/row`], [a help row's context menu], [none], [the text the row inserts],
  [`workbench/rail/left`, `…/right`], [a rail button among the side's panels by `order`], [none], [nothing],
)

The Visual editor's menus and context: @architecture-visual-editor-toolbar.

=== Search everywhere <architecture-window-search>

One quick pick (`createQuickPick`) over every `SearchProvider` (`window.registerSearchProvider`), a group each, as IntelliJ's. A provider is an `id`, a group `label`, an optional `prefix` and `order`, and `provideItems(query, token)`; its items carry their own `accept`. The window only keeps the providers: `searchEverywhere` shows them and adds Commands and Settings; without it the results show nowhere.

#table(
  columns: 4,
  table.header[Group][Prefix][Order][From],
  [Files], [`/`], [10], [`files`],
  [Headings], [`#`], [20], [`headings`],
  [Labels, Figures], [`@`], [30, 31], [`labels`, `figures`],
  [Commands], [`>`], [40], [`searchEverywhere`: `commands.getCommands()`],
  [Styles], [`*`], [50], [`styles`],
  [Comments], [`!`], [60], [`comments`],
  [Settings], [`:`], [70], [`searchEverywhere`: `workspace.getConfigurationProperties()`],
  [Text], [`%`], [90], [`textFiles`],
)

=== Files and editors <architecture-window-files>

Extensions read through `project` and change through `workspace.applyEdit` (a `FileChange`, @architecture-core-project), never `project.apply`, so no extension changes a file the host vetoed.

- A `TextEditor` is the shown document's editor (`activeTextEditor`), its `document` a `TypstDocument`.
- *The window's settings* (`workbench.theme`, `workbench.rightSidePanel`) are the widget's: it declares them like an extension's (@architecture-extensions-settings) and calls `window.setTheme` / `setDefaultSidePanel`. The window reads no settings.

=== Custom editors <architecture-window-custom-editors>

Every file opens in a custom editor (`registerCustomEditorProvider`), a panel per tab. The widget's `DocumentEditors` (`src/editor/widget/`) registers the Visual and Source editor first, so they win ties; a Typst editor's panel names its `textEditor` (then `activeTextEditor`) and its `contentElement` (where the editor frame goes).

- *Kept alive while hidden* (`retainContextWhenHidden`: cursor, scroll, undo history). One `TextEditor` per document spans both; the one shown takes the other's selection. The window knows neither editor.
- *A file several editors match gets a tab each*; the one picked is remembered.

#table(
  columns: 3,
  table.header[View type][Pattern][Priority],
  [`visualEditor`, `sourceEditor`], [`*.typ`, retained], [default (Visual registered first)],
  [`diagrams.editor`], [`*.drawio.png`], [110],
  [`spreadsheets.editor`], [`*.ic`], [default],
  [`images.editor`], [`*.{png,jpg,jpeg,gif,svg,webp}`], [default],
  [`textFiles.editor`], [`*.{csv,json,yaml,yml,toml,xml,bib,txt,md,mmd}`], [default],
  [`files.file`], [`*`: read-only name, size and type], [`'fallback'`],
)

=== Help <architecture-window-help>

A `HelpSheet` (`languages`) is plain data, no markup: the `help` extension renders the shown file's sheets; a row drags into an editor or inserts at the cursor, a `typst` sheet's rows as Typst; `help/row` is its menu. Sheets: `typst`, `mermaid`, `ironcalc`, `bibtex`.

=== Drop edits <architecture-window-drop-edits>

Drops into the Visual and Source editors go through the widget's `document-drops.ts`:

- *Providers know only project files* (`languages.registerDocumentDropEditProvider`): a file from the computer is uploaded first.
- *The first provider's edit* is inserted where it was dropped; none taking it, `window.onDidDropFiles` fires.

=== Copy and paste <architecture-window-paste>

#figure(
  mermaid(read("../diagrams/window-paste.mmd"), width: 75%),
  caption: [`languages` only keeps the providers; without the `clipboard` extension the editors paste as ProseMirror and CodeMirror do.],
)

- *Order* (`sortPasteEdits` in `clipboard/paste-as.ts`): by provider `priority`, so the clipboard's own (0) come last; an edit goes after the kinds in its `yieldTo`; duplicate texts drop out, and `text.plain` takes the place of the first, so a paste with formatting always offers plain text. ⌘⇧V prefers `text.plain`, the Source editors `typst`.
- *Every provider resolves the edit that goes in*, whatever its kind (`imports` adds imports, `labels` renames clashing labels); overlapping additional edits are dropped.
- *All providers are asked at paste time*: the clipboard can't be read later.
- *Known imports* (`languages.registerKnownImport`) tell `imports` where a name of text from outside the widget comes from (`mermaid` from `@preview/merman:0.4.0`) without knowing the extension that declares it.

=== Source controls <architecture-window-scm>

`scm` only keeps source controls: `collaboration` registers a room's GitLab branch (`scm.registerSourceControl`), `sourceControl` shows each one (status bar, file decorations, "Save to …"); neither knows the other.

== How extensions hook in <architecture-window-extensions>

A feature with a place of its own is a side panel: the window gives it a rail button and an empty `body`; the extension renders into it and talks to the user through `window` only.

```ts
// simplified from src/extensions/help/help.ts
const INSERT = 'help.insertAtCursor';

activate({ window, languages, commands, subscriptions }) {
  const side = window.registerSidePanel('help', { label: 'Help', icon: HELP_ICON });
  const panel = new HelpPanel(side.body, {
    insert: (text) => void commands.executeCommand(INSERT, text),
    showContextMenu: (text, anchor, title) =>
      window.showContextMenu('help/row', { anchor, title, args: [text] }),
  });
  const render = () => {
    const languageId = languages.getLanguageId(window.activeFile);
    panel.render(languages.getHelpSheets(languageId), ['text/plain']);
  };
  render();
  subscriptions.push(
    side,
    commands.registerCommand(INSERT, (text: string) =>
      window.activeTextEditor?.insertSnippet(text)),
    window.registerMenuItem('help/row', { command: INSERT, title: 'Insert at cursor' }),
    window.onDidChangeActiveFile(render),
  );
},
```

- *Places:* `registerSidePanel`, `registerStatusBarItem`, `registerCustomEditorProvider`, `registerEditorFrame`, `registerMenuItem`, `registerFileDecorationProvider`, `registerSearchProvider`, `registerStyleSheet`.
- *Every registration is a `Disposable`* into `subscriptions`; the window applies it to editors created later.
- *Keys and commands* are declared in `contributes` and run through `commands` (@architecture-window-commands).
