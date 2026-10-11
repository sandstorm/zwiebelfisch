#import "../template.typ": mermaid

= Workbench <architecture-workbench>

`src/hosts/workbench/` and VS Code's namespaces in `src/hosts/{commands,window,scm,languages,workspace}/`. The widget's frame, the extension API's entry, and the composition of all hosts. The frame knows no feature by name: a feature is a `TypstExtension`.

#figure(
  mermaid(read("../diagrams/workbench-composition.mmd"), width: 85%),
  caption: [What `createTypstEditor` composes.],
)

== Concepts <architecture-workbench-concepts>

- *`TypstExtension`* (@extensions-overview): registers its contributions once, at activation. Hosts apply them to every editor they create later.
- *`ExtensionContext`*: `project`, `subscriptions`, `globalState` / `workspaceState`, the five namespaces, `workbench` (the frame), and the view hosts `visualEditor`, `sourceEditor`, `preview`.
- *Namespaces as hosts* (table below): each is its own module, an interface plus a host class implementing it directly. No forwarding facade.
- *Generic contribution points*: extensions never depend on each other, not even through a service registry. A host offers a point any extension may use; the consumer reads every contribution. Competing contributions are ordered by an explicit tie-breaker, never by registration order alone.
- *The frame*: `WorkbenchLayout` (a `SideBar` on the left and on the right, the editing area between them, the status bar); `EditorTabs` (a tab per editor of the shown file, the `editor/title` menu at the end).
- *Two sides* (`SideBar`, VS Code's primary and secondary side bar, named by place): a rail on the widget's outer edge with a button per side panel (`registerSidePanel(id, { side })`, default left), one panel shown per side, a separator on its inner edge (drag or arrow keys; the left side in pixels, the right side as 20–80 % of the widget). Which panel shows: the viewer's pick (clicking the shown one hides the side, the editing area takes the room), else the side's default panel (the right side's: the setting `workbench.rightSidePanel`, default `preview`), else the first panel whose owner asked (`setDefault`, e.g. `files.panel`). Picks and sizes are kept in the session memento (`layout`). Narrower than 720 px, the left panel lies over the editing area.
- *The preview is the right side's built-in panel* (`preview`), registered by the workbench before any extension, so it comes first on the right rail. It compiles whether shown or not (diagnostics, raw box snippets, selection shading).
- *Every file opens in a custom editor* (`window`'s `CustomEditors`). The Visual and the Source editor are the two built-in ones for `*.typ` (`visualEditor`, `sourceEditor`), registered by the workbench (`TypstEditors`) before any extension, so they win ties. They stay hosts with contribution points, like VS Code's built-in text editor.
- *Tabs = "open with"*: a file several editors match gets a tab each; the one picked (a tab, `open(path, { viewType })`) is the user's choice for every later file it matches. Visual / Source is this switch for Typst files.
- *`TypstEditors`*: a document's view is made when the document is first shown in it, in a retained panel (`retainContextWhenHidden`): hidden, with cursor, scroll and undo history, while other files show; disposed when the file is deleted. Per document one `TextEditor` over both editors (`activeTextEditor`); the editor frame goes into the visible editor (around any other editor's panel).
- *Menus*: the workbench keeps the entries (`registerMenuItem`) and shows `editor/title` in the tab bar; every other menu pops up through `window.showContextMenu(menuId, { anchor, title, context, args })`, which reads the entries whose `when` holds and runs the chosen one's command with `args` (the file panel: `explorer/context` on a row, `file/newFile` under "New"). Views never draw menus of their own.
- *Search everywhere* (`window`'s `search/`): one quick pick (`QuickInput.createQuickPick`, rows set as the user types) over every registered `SearchProvider`, a group each. Each change of the text cancels the previous round (`CancellationTokenSource`, `core/cancellation`) and asks the providers of the typed prefix, or all; synchronous results show at once, async ones as they come. Items are matched fuzzily (label, else description) unless the provider matched them. Opened by double Shift (the window listens on the widget in the capture phase, so inside the editors too: a second Shift within 300 ms of releasing the first, nothing else pressed; it fires on the second release; not while an input box or quick pick is open), by the command `workbench.action.searchEverywhere` and by a button at the bottom of the left rail. The workbench adds two groups of its own: the commands extensions declare (`contributes.commands`) and the settings.
- *State*: `StorageMemento` behind `globalState` and `workspaceState` (@extensions-workbench-api-state). Keys: `typst-editor:global:<id>:<key>`, `typst-editor:<main file>:<id>:<key>`.

#table(
  columns: (auto, 3fr, 2fr),
  table.header[Namespace][Offers][Tie-breaker],
  [`commands`], [commands by id (`<extension>.<verb>`), key bindings], [—],
  [`window`], [messages, input box, quick pick, save dialog, contributed menus (`showContextMenu`), progress (`withProgress`), search everywhere's providers, status bar items, custom editors, file decorations, `activeFile`, `activeTextEditor`], [status bar: `alignment` + `priority`; custom editors: the user's choice, then `priority` (`'fallback'`: only files no other editor matches), then pattern specificity; search providers: `order`, then `id`],
  [`scm`], [source controls], [— (all listed; a duplicate id throws)],
  [`languages`], [document link providers and help providers for a `DocumentSelector` (by `languageId`); the language of a path (`getLanguageId`, from `contributes.languages` and the workbench's `typst`)], [links: `priority` (default 100); help: all shown; an ending declared for two languages throws],
  [`workspace`], [`applyEdit`, settings (`getConfiguration`, `onDidChangeConfiguration`)], [—],
  [`workbench`], [`open`, side panels (left and right), editor frame, menus, style sheets, dropped files, `user`], [menus: `group` + `order`; side panels: `order` within their side],
)

== Lifecycle <architecture-workbench-lifecycle>

+ The constructor makes every host and the frame, and puts the CSS in: first the tokens and the frame (`typst-editor.css`) with the workbench's own (`<style id="typst-editor-styles">`), then each host's `<name>.css` (its `styleSheet`; the Visual editor's after ProseMirror's vendored `prosemirror.css`). The extensions' follow at activation.
+ `activate(list)` declares every extension's settings (`contributes.configuration`) and languages (`contributes.languages`), and collects its commands for people (`contributes.commands`), so any declared setting and language is readable during activation. Values for undeclared ids: console warning, ignored.
+ Extensions activate in list order (`ExtensionHost`; a duplicate id throws).
+ The main file is shown (in the editor the option `viewType` names) and compiled. Views are created later, on demand, with what was registered.
+ `dispose()` disposes the extensions in reverse list order, each one's subscriptions in reverse, then the frame.

== Loading <architecture-workbench-loading>

What the widget shows depends on what has arrived. Nothing in the editing area waits for the engine.

#table(
  columns: (auto, 1fr),
  table.header[Arrived][Shown],
  [the JS (main chunk, CSS inlined)], [the frame and the shown file's text, editable: `createTypstEditor` is synchronous, the views read only `TypstDocument`s],
  [the engine worker's chunk, then the wasm (22 MB, streamed)], [the preview's loader: "Loading the Typst compiler… 3.1 / 6.6 MB" (in the pane only, not in the status bar)],
  [the engine, compiling], [the loader: "Compiling…" (the status bar shows the compile status); font files and packages as they download ("Downloading \@preview/merman 0.4.0…")],
  [the first pages], [the pages; raw boxes swap their code for their pictures (each decoded first, faded in)],
)

- *`window.withProgress(options, task)`* (VS Code's): shows a task until its promise settles. `ProgressLocation.Window`: a spinner and "title: message" on the status bar's right. `ProgressLocation.EditingArea` (ours): a note over the editing area in its grid cell, the editing area `inert` and `aria-busy` meanwhile; for what the views must wait for (collaboration: "Connecting to the room…" until the room's text is there).
- What the preview loads (`PreviewProgress`, @architecture-preview-concepts) shows in the preview's pane only, never in the status bar; the workbench turns a compiler that cannot be loaded into an error message.

== Changes and settings <architecture-workbench-changes>

- `workspace.applyEdit(change)`: the project's check, the host's `allowFileChange` (may be async), the project's check again, then apply. Resolves to the refusal in words, or null.
- Settings: declared by extensions and by the workbench (`workbench.theme`, `workbench.rightSidePanel`); values come from the host and replace each other as a whole. A value of the wrong type falls back to the default, with a warning. `inspect(key)` tells whether the host set one.

API reference: @extensions-workbench-api.
