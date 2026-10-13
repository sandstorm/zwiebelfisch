#import "../template.typ": mermaid

= Workbench <architecture-workbench>

`src/hosts/workbench/` is the widget's frame, the extension API's entry and the composition of all hosts; VS Code's namespaces live in `src/hosts/{commands,window,scm,languages,workspace}/`. The frame knows no feature by name: a feature is a `TypstExtension`.

#figure(
  mermaid(read("../diagrams/workbench-composition.mmd"), width: 85%),
  caption: [What `createTypstEditor` composes.],
)

== Concepts <architecture-workbench-concepts>

- *`TypstExtension`* (@architecture-extensions-overview) registers its contributions once, at activation. Hosts apply them to every editor they create later.
- *`ExtensionContext`*: `project`, `subscriptions`, `globalState` / `workspaceState`, the five namespaces, `workbench` (the frame) and the view hosts `visualEditor`, `sourceEditor`, `preview`.
- *Namespaces are hosts*: each is a module with an interface and a host class implementing it. No facade.
- *Generic contribution points*: extensions never depend on each other. A host offers a point, the consumer reads every contribution, and an explicit tie-breaker orders competing ones (table below).
- *The frame*: `WorkbenchLayout` (a `SideBar` left and right, the editing area between, the status bar) and `EditorTabs` (a tab per editor of the shown file, the `editor/title` menu, "View ▾").
- *Two sides*, as VS Code's primary and secondary side bar: a rail with a button per panel (`registerSidePanel(id, { side, alignment, order })`), one panel shown per side, sizes kept in the session. Narrower than 720 px, the left panel lies over the editing area.
- *The preview is the right side's built-in panel* (`preview`). It compiles whether shown or not.
- *Every file opens in a custom editor* (`window`'s `CustomEditors`). The Visual and the Source editor are the built-in ones for `*.typ`, registered by `TypstEditors` before any extension, as VS Code's built-in text editor.
- *Tabs are "open with"*: a file several editors match gets a tab each; the one picked is remembered for later files.
- *`TypstEditors`* keeps a document's editors alive while hidden (`retainContextWhenHidden`), with cursor, scroll and undo history. One `TextEditor` per document spans both; the one shown gets the other's selection.
- *Menus*: the workbench keeps the entries (`registerMenuItem`) and pops them up with `window.showContextMenu(menuId, { anchor, title, context, args })`. An entry with `toggled` is a checkbox. Editors and side panels never draw menus of their own.
- *Search everywhere* (`window/search/`): one quick pick over every `SearchProvider`, a group each, as IntelliJ's. Opened by Shift twice, `workbench.action.searchEverywhere` or the left rail's button. The workbench adds the groups for commands and settings.
- *State*: `StorageMemento` behind `globalState` and `workspaceState` (@architecture-workbench-api-state).

#table(
  columns: (auto, 3fr, 2fr),
  table.header[Namespace][Offers][Tie-breaker],
  [`commands`], [commands by id (`<extension>.<verb>`), key bindings], [—],
  [`window`], [messages, input box, quick pick, save dialog, menus (`showContextMenu`), `withProgress`, search providers, status bar items, custom editors, file decorations, `activeFile`, `activeTextEditor`], [status bar: `alignment` + `priority`; custom editors: the user's choice, then `priority`, then pattern specificity; search: `order`, then `id`],
  [`scm`], [source controls], [all listed; a duplicate id throws],
  [`languages`], [document links, drop edits, paste edits, help providers by `DocumentSelector`; `getLanguageId`], [links, drop edits: `priority`; help, paste edits: all],
  [`workspace`], [`applyEdit`, settings (`getConfiguration`, `onDidChangeConfiguration`)], [—],
  [`workbench`], [`open`, side panels, editor frame, menus, style sheets, dropped files, `user`], [menus: `group` + `order`; side panels: `order`],
)

== Lifecycle <architecture-workbench-lifecycle>

+ The constructor makes every host and the frame and adds the CSS: the frame's, then each host's. Extensions add theirs at activation.
+ `activate(list)` declares every extension's settings, languages and commands (`contributes`), so they are readable during activation.
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

- *`window.withProgress(options, task)`* (VS Code's) shows a task until it settles: `ProgressLocation.Window` on the status bar, `ProgressLocation.EditingArea` (ours) as a note over the editing area, which is `inert` meanwhile (collaboration: "Connecting to the room…").
- *The preview's progress* shows in its pane only; a compiler that cannot load or crashed becomes an error message.

== Changes and settings <architecture-workbench-changes>

- *`workspace.applyEdit(change)`* checks the project, the host's `allowFileChange`, the project again, then applies. It resolves to the refusal in words, or null.
- *Settings* are declared by extensions and the workbench (`workbench.theme`, `workbench.rightSidePanel`), as VS Code's settings. A value of the wrong type falls back to the default, with a warning.

API reference: @architecture-workbench-api.
