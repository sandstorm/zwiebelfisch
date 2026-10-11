= Workbench <architecture-workbench>

`src/hosts/workbench/` and VS Code's namespaces in `src/hosts/{commands,window,scm,languages,workspace}/`. The widget's frame, the extension API's entry, and the composition of all hosts. The frame knows no feature by name: a feature is a `TypstExtension`.

```
createTypstEditor ─► WorkbenchHost(host, project, options).activate(extensions)
                     ├─ namespaces: CommandsHost  WindowHost  ScmHost  LanguagesHost  WorkspaceHost
                     ├─ view hosts: VisualViewHost  SourceViewHost  Preview
                     ├─ frame:      WorkbenchLayout  EditorTabs  TypstEditors  Menus  StyleSheets  FileDrops  ColorScheme
                     └─ ExtensionHost: activate(context) per extension, in list order
```

== Concepts <architecture-workbench-concepts>

- *`TypstExtension`* (@extensions-overview): registers its contributions once, at activation. Hosts apply them to every view they create later.
- *`ExtensionContext`*: `project`, `subscriptions`, `globalState` / `workspaceState`, the five namespaces, `workbench` (the frame), and the view hosts `visualView`, `sourceView`, `preview`.
- *Namespaces as hosts* (table below): each is its own module, an interface plus a host class implementing it directly. No forwarding facade.
- *Generic contribution points*: extensions never depend on each other, not even through a service registry. A host offers a point any extension may use; the consumer reads every contribution. Competing contributions are ordered by an explicit tie-breaker, never by registration order alone.
- *The frame*: `WorkbenchLayout` (side panels with rail buttons, editing column, preview, status bar); `EditorTabs` (a tab per editor of the shown file, the `editor/title` menu at the end).
- *Every file opens in a custom editor* (`window`'s `CustomEditors`). The Visual and the Source view are the two built-in ones for `*.typ` (`visualView.editor`, `sourceView.editor`), registered by the workbench (`TypstEditors`) before any extension, so they win ties. They stay hosts with contribution points, like VS Code's built-in text editor.
- *Tabs = "open with"*: a file several editors match gets a tab each; the one picked (a tab, `open(path, { viewType })`) is the user's choice for every later file it matches. Visual / Source is this switch for Typst files.
- *`TypstEditors`*: a document's view is made when the document is first shown in it, in a retained panel (`retainContextWhenHidden`): hidden, with cursor, scroll and undo history, while other files show; disposed when the file is deleted. Per document one `TextEditor` over both views (`activeTextEditor`); the editor frame goes into the visible view.
- *State*: `StorageMemento` behind `globalState` and `workspaceState` (@extensions-workbench-api-state). Keys: `typst-editor:global:<id>:<key>`, `typst-editor:<main file>:<id>:<key>`.

#table(
  columns: (auto, 3fr, 2fr),
  table.header[Namespace][Offers][Tie-breaker],
  [`commands`], [commands by id (`<extension>.<verb>`), key bindings], [—],
  [`window`], [messages, input box, quick pick, save dialog, status bar items, custom editors, file decorations, `activeFile`, `activeTextEditor`], [status bar: `alignment` + `priority`; custom editors: the user's choice, then `priority` (`'fallback'`: only files no other editor matches), then pattern specificity],
  [`scm`], [source controls], [— (all listed; a duplicate id throws)],
  [`languages`], [document link providers], [`priority` (default 100)],
  [`workspace`], [`applyEdit`, settings (`getConfiguration`, `onDidChangeConfiguration`)], [—],
  [`workbench`], [`open`, side panels, editor frame, menus, style sheets, dropped files, `user`], [menus: `group` + `order`; side panels: `order`],
)

== Lifecycle <architecture-workbench-lifecycle>

+ The constructor makes every host and the frame, and puts the CSS in: first the tokens and the frame (`typst-editor.css`) with the workbench's own (`<style id="typst-editor-styles">`), then each host's `<name>.css` (its `styleSheet`; the Visual view's after ProseMirror's vendored `prosemirror.css`). The extensions' follow at activation.
+ `activate(list)` declares every extension's settings (`contributes.configuration`), so any declared setting is readable during activation. Values for undeclared ids: console warning, ignored.
+ Extensions activate in list order (`ExtensionHost`; a duplicate id throws).
+ The main file is shown (in the view `mode` names) and compiled. Views are created later, on demand, with what was registered.
+ `dispose()` disposes the extensions in reverse list order, each one's subscriptions in reverse, then the frame.

== Changes and settings <architecture-workbench-changes>

- `workspace.applyEdit(change)`: the project's check, the host's `allowFileChange` (may be async), the project's check again, then apply. Resolves to the refusal in words, or null.
- Settings: declared by extensions and by the workbench (`workbench.theme`); values come from the host and replace each other as a whole. A value of the wrong type falls back to the default, with a warning. `inspect(key)` tells whether the host set one.

API reference: @extensions-workbench-api.
