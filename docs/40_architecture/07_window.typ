#import "../template.typ": api, mermaid, unreviewed

= Window <architecture-window>

#unreviewed

Everything the user sees and interacts with (VS Code's `window`), in `src/hosts/window/`: the frame, the shown file, menus, messages, side panels. VS Code's other namespaces sit beside it in `src/hosts/{commands,languages,scm,workspace}/` and are covered here too. The window knows no feature by name; features are extensions (@architecture-extensions-host).

#figure(
  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),
  caption: [The frame: a rail and a side panel per side, the editing area between, the status bar below.],
)

== Concepts <architecture-window-concepts>

- *Namespaces are hosts:* each is a module with an interface and a host class implementing it; no facade. The shapes are VS Code's (#link("https://code.visualstudio.com/api/references/vscode-api")[API reference]); the doc comments say where they differ.
- *Contributions are registered once*, at activation; the hosts apply them to every editor they create later. Competing ones are ordered as @architecture-extensions-rules says.
- *Editors and side panels never draw menus or popups of their own:* they talk to the user through `window`, so one input, one menu and one message area serve all.
- *One side panel per side.* Sizes and the panels picked are kept for the session; narrower than 720 px the left panel lies over the editing area. The preview is the right side's built-in panel (`preview`) and compiles whether shown or not.
- *`DocumentEditors`* keeps a document's Visual and Source editor alive while hidden (`retainContextWhenHidden`: cursor, scroll, undo history). One `TextEditor` per document spans both; the one shown takes the other's selection.

== Loading <architecture-window-loading>

Nothing in the editing area waits for the engine: `createEditor` is synchronous.

#table(
  columns: (auto, 1fr),
  table.header[Arrived][Shown],
  [the JS], [the frame and the shown file's text, editable],
  [the worker, then the wasm (streamed)], [the preview's loading note (`previewProgress`): "Loading the Typst compiler… 3.1 / 6.6 MB"],
  [the engine, compiling], ["Compiling…", then packages and fonts as they download],
  [the first pages], [the pages; raw boxes swap their code for their pictures],
)

The preview's progress shows in its pane only; a compiler that cannot load or crashed becomes an error message. `ProgressLocation.EditingArea` (ours) makes the editing area `inert` under a note until a task settles (collaboration: "Connecting to the room…").

== Extension API <architecture-window-api>

#api("/src/hosts/window/window.ts", "WindowApi", docs: "first-sentence")

=== Commands and keys <architecture-window-commands>

#api("/src/hosts/commands/commands.ts", "Commands", docs: "first-sentence")
#api("/src/hosts/commands/commands.ts", "KeybindingContribution")

- *Keys are caught before any editor*, so a binding means the same everywhere; an extension only declares them (`contributes.keybindings`), never listens itself.
- *Search everywhere runs `contributes.commands` without arguments:* declare only commands that work without any.
- *Commands other extensions rely on:* `workbench.view.<id>` per side panel (the window's; extensions declare its key: `files` Alt+1, `search` Alt+3, ⌃1 / ⌃3 on the Mac); `workbench.action.searchEverywhere(text?)` (`searchEverywhere`); `editor.action.pasteAs({ kind? })` (`clipboard`).

=== Menus <architecture-window-menus>

Every button is a menu entry: `registerMenuItem` adds it, `showContextMenu` or a host shows the menu. The types live with the commands.

#api("/src/hosts/commands/commands.ts", "MenuItem", docs: "first-sentence")

#table(
  columns: 4,
  table.header[Menu][Where][Context][Command gets],
  [`editor/title`], [the right end of the editing area's tab bar], [`activeCustomEditorId`, `resource`], [nothing],
  [`view`], [the View menu; groups `editor`, `preview` (@architecture-preview-view)], [as `editor/title`], [nothing],
  [`preview/title`], [the preview's toolbar (@architecture-preview-contributions)], [`previewRenderer`], [the context],
  [`file/newFile`], ["New" in the file panel's header], [`view`, `resource`, `resourceKind`, `resourceIsMain`], [the row's path],
  [`explorer/context`], [a file panel row's context menu], [as `file/newFile`], [the row's path],
  [`help/row`], [a help row's context menu], [none], [the text the row inserts],
  [`workbench/rail/left`, `…/right`], [a rail button among the side's panels by `order`], [none], [nothing],
)

The Visual editor's menus and context: @architecture-visual-editor-toolbar.

=== Search everywhere <architecture-window-search>

One quick pick over every `SearchProvider`, a group each (IntelliJ's). The window only keeps the providers; the `searchEverywhere` extension shows them (`createQuickPick`) and adds Commands and Settings. Without it the results show nowhere.

#api("/src/hosts/window/window.ts", "SearchProvider")

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

#api("/src/hosts/workspace/workspace.ts", "Workspace", docs: "first-sentence")
#api("/src/hosts/window/window.ts", "TextEditor", docs: "first-sentence")

- *Read through `project`, change through `workspace.applyEdit`*, never `project.apply`: it asks the project, the host's `allowFileChange`, the project again, then applies. So no extension changes a file the host vetoed. `FileChange`: @architecture-core-project.
- *The window's own settings* (`workbench.theme`, `workbench.rightSidePanel`) are declared like an extension's (@architecture-extensions-settings).

=== Custom editors <architecture-window-custom-editors>

Every file opens in a custom editor, Typst files too: the Visual and Source editor are the built-in ones for `*.typ`, registered by `DocumentEditors` before any extension (as VS Code's text editor). A file several editors match gets a tab each; the one picked is remembered.

#api("/src/hosts/window/window.ts", "CustomEditorOptions", docs: "first-sentence")
#api("/src/hosts/window/window.ts", "CustomEditorPanel", docs: "first-sentence")

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

#api("/src/hosts/languages/languages.ts", "HelpSheet")

Plain data, no markup: the `help` extension renders the shown file's sheets; a row drags into an editor or inserts at the cursor, a `typst` sheet's rows as Typst; `help/row` is its menu. Sheets: `typst`, `mermaid`, `ironcalc`, `bibtex`.

=== Drop edits <architecture-window-drop-edits>

#api("/src/hosts/languages/languages.ts", "DocumentDropEditProvider")

The widget (`editor/widget/document-drops.ts`) asks them for the Visual and Source editors: files from the computer are uploaded first, then dropped as project files. Dropped files no editor took go to `window.onDidDropFiles`.

=== Copy and paste <architecture-window-paste>

#api("/src/hosts/languages/languages.ts", "DocumentPasteEditProvider")
#api("/src/hosts/languages/languages.ts", "DocumentPasteEdit", docs: "first-sentence")

`languages` only keeps the providers; the `clipboard` extension asks them in the Visual and Source editors. Without it no provider takes part: the editors paste as ProseMirror and CodeMirror do.

- *Order* (`sortPasteEdits` in `clipboard/paste-as.ts`): by provider `priority`, so the clipboard's own (0) come last; an edit goes after the kinds in its `yieldTo`; duplicate texts drop out, and `text.plain` takes the place of the first, so a paste with formatting always offers plain text. ⌘⇧V prefers `text.plain`, the Source editors `typst`.
- *Every provider resolves the edit that goes in*, whatever its kind (`imports` adds imports, `labels` renames clashing labels); overlapping additional edits are dropped.
- *All providers are asked at paste time*, only those whose `pasteMimeTypes` the clipboard has: it can't be read later.
- *Known imports* (`languages.registerKnownImport`) tell `imports` where a name of text from outside the widget comes from (`mermaid` from `@preview/merman:0.4.0`) without knowing the extension that declares it.

=== Source controls <architecture-window-scm>

#api("/src/hosts/scm/scm.ts", "Scm", docs: "first-sentence")
#api("/src/hosts/scm/scm.ts", "SourceControl", docs: "first-sentence")

Collaboration registers a room's GitLab branch; `sourceControl` shows it (status bar, file decorations, "Save to _label_…"). Neither knows the other.
