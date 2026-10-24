#import "../template.typ": mermaid, unreviewed

= Extensions <architecture-extensions>

Every feature is an extension in `src/extensions/<name>/`.

== Extension Shape <architecture-extensions-shape>

An extension is `{ id, contributes, activate(context) }`. `contributes` declares settings, commands, keys and languages up front; `activate` registers everything else and pushes each registration into `context.subscriptions`.

```ts
import { Disposable, type Extension } from 'zwiebelfisch';
import { highlightWhitespace } from '@codemirror/view';

const TOGGLE = 'invisibles.toggle';

export function invisibles(): Extension {
  return {
    id: 'invisibles',
    contributes: {
      configuration: { properties: {
        'invisibles.show': { type: 'boolean', default: false },
      } },
      commands: [{ command: TOGGLE, title: 'Show invisible characters on / off' }],
    },
    activate({ commands, window, workspace, sourceEditor, subscriptions }) {
      let shown = workspace.getConfiguration('invisibles').get('show', false);
      let marks: Disposable | null = null;
      const show = (on: boolean) => {
        shown = on;
        marks?.dispose();
        marks = on
          ? sourceEditor.registerCodeMirrorExtension({}, highlightWhitespace())
          : null;
      };
      show(shown);
      subscriptions.push(
        commands.registerCommand(TOGGLE, () => show(!shown)),
        window.registerMenuItem('view', {
          command: TOGGLE, title: 'Invisible characters', toggled: () => shown,
        }),
        new Disposable(() => marks?.dispose()),
      );
    },
  };
}
```

```ts
// the host page: the built-ins, with this one in place of the built-in `invisibles`
const mine = invisibles();
createEditor(element, {
  extensions: (builtins) => [...builtins.filter((e) => e.id !== mine.id), mine],
});
```

*Folder:* `<name>.ts` (the factory and `activate`), `<name>.css`, `model/` and one folder per host it contributes to, e.g. (`visual-editor/`, `source-editor/`, `preview/`, `window/`).

== Settings <architecture-extensions-settings>

A setting is a `ConfigurationProperty` in `contributes.configuration`.

```ts
activate({ workspace, subscriptions }) {
  const config = () => workspace.getConfiguration('pdfExport');
  let download = config().get('download', true);
  subscriptions.push(workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('pdfExport.download')) {
      download = config().get('download', true);
    }
  }));
}
```

- *Values change at any time:* the host page (`createEditor({ settings })`, `editor.updateSettings`) and the user set them.
- *A wrong value counts as unset.* An undeclared setting is ignored. Both log a warning to the console.

== Extension Context API <architecture-extensions-points>

`activate(context)` gets all callbacks needed to register into an extension point:

#table(
  columns: (auto, auto, 1fr),
  table.header[`context.`][Host][What it offers],
  [`commands`], [`hosts/commands`], [`registerCommand`; keys via `contributes.keybindings`],
  [`window`], [`hosts/window`], [`registerMenuItem`, `registerSidePanel`, `registerTitleBarItem`, `registerStatusBarItem`, `registerEditorProvider`, `registerFileDecorationProvider`, `registerSearchProvider`, `registerStyleSheet`, `registerEditorHeaderFooter`],
  [`workspace`], [`hosts/extension-host/workspace`], [`contributes.configuration`; `applyEdit`, `fs.stat`, `registerFileSystemProvider`],
  [`languages`], [`hosts/languages`], [`registerDocumentLinkProvider`, `registerDocumentDropEditProvider`, `registerDocumentPasteEditProvider`, `registerHelpSheet`, `registerImportSource`; languages via `contributes.languages`],
  [`scm`], [`hosts/scm`], [`registerSourceControl` (with an optional `quickDiffProvider` and `historyProvider`)],
  [`visualEditor`], [`hosts/visual-editor`], [`registerNode`, `registerMark`, `registerTiptapExtension`, `registerSubmenu`, `registerFloatingBar`, `registerCompletionItemProvider`, `registerHighlightProvider`, `registerRawBoxRenderer`, `registerRawBoxBehavior`],
  [`sourceEditor`], [`hosts/source-editor`], [`registerCodeMirrorExtension`],
  [`preview`], [`hosts/preview`], [`registerViewOption`, `registerPdfExportOption`, `registerRenderer`, `registerPaneOverlay`, `createPageOverlay`],
  [`project`], [`core/project`], [the files, read only: `paths`, `document` (a `TypstDocument`), `content`, `main`, `onDidChangeFile`; changes go through `workspace.applyEdit`],
  [`subscriptions`], [`hosts/extension-host`], [what the extension pushes here is disposed with the widget, last first],
  [`globalState`], [`hosts/extension-host`], [values kept per viewer (`localStorage`), scoped by the extension's id: `get`, `update`],
  [`workspaceState`], [`hosts/extension-host`], [values kept per project and browser session (`sessionStorage`): `get`, `update`],
)

Every `register…` returns a `Disposable`; push it into `subscriptions`, so it is disposed with the widget.

== Commands <architecture-extensions-commands>

`commands.registerCommand(id, handler)`: a named action. Menus, keys, search everywhere and other code run it by id (`commands.executeCommand(id, ...args)`).

```ts
contributes: {
  commands: [{ command: 'wordCount.show', title: 'Count words' }],
  keybindings: [{ command: 'wordCount.show', key: 'Mod+Alt+KeyW' }],
},
activate({ commands, window, subscriptions }) {
  subscriptions.push(commands.registerCommand('wordCount.show', () => {
    const text = window.activeTextEditor?.document.text ?? '';
    const words = text.split(/\s+/).filter(Boolean).length;
    void window.showInformationMessage(`${words} words`);
  }));
}
```

- *Keys:* list them in `contributes.keybindings`.
- *`contributes.commands` is the list people can pick from:* search everywhere (⌘P or Shift Shift, then `>`) shows every command declared there and runs the chosen one *without arguments*. A command that cannot work without an argument should only be registered with `registerCommand`, and not declared.

== Menus <architecture-extensions-menus>

`window.registerMenuItem(menuId, item)`: every button, dropdown entry and context menu entry is a menu entry that runs a command. Whoever draws a menu asks for its entries each time it is rendered.

```ts
activate({ commands, window, subscriptions }) {
  let wrap = false;
  subscriptions.push(
    commands.registerCommand('wordWrap.toggle', () => { wrap = !wrap; }),
    window.registerMenuItem('view', {
      command: 'wordWrap.toggle', title: 'Wrap lines',
      toggled: () => wrap,                                  // a check mark
      when: (context) => context.activeEditorId === 'sourceEditor',
      group: 'editor', order: 20,
    }),
  );
}
```

=== The menus <architecture-extensions-menu-ids>

#table(
  columns: (auto, 2fr, 1.4fr, 0.9fr),
  table.header[Menu][Where it shows, what is in it][Context][Command gets],
  [`window/editorTitle`], [buttons at the right end of the editor tab bar: "Comment"], [`activeEditorId` \ `resource`], [—],
  [`window/view`], [the "View" dropdown in the title bar: invisible characters, the preview's view options], [as `window/editorTitle`], [—],
  [`window/railLeft` \ `window/railRight`], [a button on the rail beside the side panels' buttons: search everywhere], [—], [—],
  [`preview/toolbar`], [the preview's toolbar: follow cursor, renderers, zoom, "Download PDF"], [`previewRenderer`], [the context],
  [`visualEditor/toolbar`], [the Visual editor's toolbar row, in groups `1_history` … `6_comments`: undo, lists, align, comment], [the editor: `document`, `selection()`, `tiptap`], [the context],
  [`visualEditor/textStyle`], [the text style dropdown in that row: headings, styles], [as above], [the context],
  [`visualEditor/insert`], [the "Insert" dropdown: table, image, figure, diagram, math, outline, page break, label, …], [as above], [the context],
  [`visualEditor/selection`], [the bar floating above a text selection: bold, italic, link, comment, label, Styles], [as above], [the context],
  [`visualEditor/align` \ `visualEditor/inlineStyles` \ `visualEditor/table` \ `visualEditor/image` \ `visualEditor/link`], [submenus and floating bars of extensions (@architecture-extensions-submenus)], [as above], [the context],
  [`files/new`], [the "New" dropdown in the file panel (drawn by `files`): file, folder, upload, diagram, spreadsheet], [`resource`, `resourceKind`, `resourceIsMain`, `resourceIsFixed`, `folderIsReadonly`], [the folder's path],
  [`files/row`], [a file row's right-click menu (drawn by `files`): new, rename, delete, set as main file, find in folder], [as `files/new`], [the row's path],
  [`help/row`], [a help row's right-click menu (drawn by `help`): insert at cursor], [—], [the row's text],
  [`collaboration/account`], [the account menu in the title bar (drawn by `collaboration`): sign out], [—], [—],
  [`guests/share`], [the menu below a member's "Share" in the title bar (drawn by `collaboration`): new guest link, revoke a link], [—], [—],
)

The window, the preview and the Visual editor draw their own menus; the last five are drawn by the extension named.

=== Entry fields <architecture-extensions-menu-item>

`when`, `enabled` and `toggled` are functions of the menu's *context*: an object the code drawing the menu passes in, saying what the menu is shown for (the shown file, the file panel row, the Visual editor with its selection). Each menu has its own. Type it with `registerMenuItem<C>` (`VisualEditorMenuContext`, `PreviewMenuContext`).

#table(
  columns: (auto, 1fr),
  table.header[`MenuItem`][Meaning],
  [`command`], [the command it runs, with the arguments the menu passes],
  [`title`, `shortTitle`, `icon`], [what it says (default: the command's title), a short form for buttons (`25%`), an SVG icon],
  [`when(context)`], [whether it shows at all; asked each time the menu shows],
  [`enabled(context)`], [whether it can be chosen now; the Visual editor's menus grey it out otherwise],
  [`toggled(context)`], [makes it a checkbox: checked in a menu, pressed in a toolbar],
  [`group`, `order`], [placement: groups by name (`navigation` first) with separators between, then `order` within a group],
  [`keybinding`], [an editor key that does the same, shown beside the entry (`Mod+B`)],
  [`category`, `keywords`], [a section title in the text style menu; other words the slash commands find it by],
)

=== Groups and order <architecture-extensions-menu-groups>

Entries with the same `group` stand together; between groups, a menu draws a separator, a toolbar a gap.

- *Groups by name:* `navigation` first, then the other groups sorted by their name as strings. That is why toolbars number theirs: `1_history` comes before `2_textStyle`.
- *Inside a group:* by `order` (lower first, default 0), then in registration order.
- *Joining or starting a group:* use an existing group's name to sit with its entries; a new name starts a group whose place follows from the name. An entry without `group` is in group `''`, which sorts first after `navigation`.

```ts
// a word count button in the Visual editor's toolbar, after the comments
window.registerMenuItem('visualEditor/toolbar', {
  command: 'wordCount.show', icon: COUNT_ICON, group: '7_tools',
});
```

#table(
  columns: (auto, 1fr),
  table.header[Menu][Its groups, in order],
  [`visualEditor/toolbar`], [`1_history`, `2_textStyle`, `3_lists`, `4_align`, `5_insert`, `6_comments`],
  [`visualEditor/textStyle`], [`''` (headings), `block` (block styles), `inline` (inline styles: toggles, never the dropdown's value), `new` ("New style…")],
  [`preview/toolbar`], [`1_sync`, `2_renderers`, `3_zoom`, `4_export`],
  [`window/view`], [`editor`, `preview`],
  [`files/new`], [`navigation`],
  [`files/row`], [`navigation` (new …), `main`, `modification`, `search`],
)

=== Submenus and floating bars <architecture-extensions-submenus>

A menu needs a place to show. The Visual editor has two kinds of place an extension can add; both are *containers only*: they get an id and a position, and their entries come from `window.registerMenuItem(id, …)` like any menu's.

#table(
  columns: (auto, 1fr, 1fr),
  table.header[][`visualEditor.registerSubmenu`][`visualEditor.registerFloatingBar`],
  [What shows], [one button in another menu that opens a dropdown], [a whole bar floating in the text],
  [Where], [in `parent`: the toolbar row or a floating bar, placed by `group` and `order` like an entry], [next to what its `anchor(context)` returns now (`null`: hidden)],
  [When], [while its menu has entries], [only the first bar by `order` with an anchor shows],
  [Examples], [`visualEditor/align`, `visualEditor/inlineStyles`, the host's `visualEditor/insert`], [`visualEditor/table`, `visualEditor/image`, `visualEditor/link`, the host's `visualEditor/selection`],
)

```ts
activate({ visualEditor, window, subscriptions }) {
  subscriptions.push(
    // a dropdown button in the toolbar row
    visualEditor.registerSubmenu({
      id: 'visualEditor/align', label: 'Align',
      parent: 'visualEditor/toolbar', group: '4_align',
      icon: ({ tiptap }) => (tiptap.isActive({ textAlign: 'center' }) ? CENTER : LEFT),
    }),
    window.registerMenuItem('visualEditor/align', { command: ALIGN_CENTER, title: 'Center' }),
    // a bar while the cursor is in a table
    visualEditor.registerFloatingBar({
      id: 'visualEditor/table', label: 'Table', order: 20,
      anchor: ({ tiptap }) => (tiptap.isActive('table') ? tableRect(tiptap) : null),
    }),
    window.registerMenuItem('visualEditor/table', { command: ADD_ROW, title: 'Row' }),
  );
}
```

=== Showing a menu of your own <architecture-extensions-menu-show>

A menu id is just a string: pick one (`outline/heading`), draw it within your extension, and let any extension add entries to it with `registerMenuItem`. Two ways to draw it:

*As a popup:* `window.showContextMenu(menuId, options)`. The window draws it at `anchor` (a button, or a point such as a right click), with the entries whose `when` holds in `context`, sorted and grouped; the chosen entry's command gets `args`. This is how the file panel shows `files/new` and `files/row`.

```ts
activate({ window, commands, subscriptions }) {
  const side = window.registerSidePanel('outline', { label: 'Outline', icon: ICON });
  const more = window.ownerDocument.createElement('button');
  more.textContent = '⋯';
  more.addEventListener('click', () => window.showContextMenu('outline/heading', {
    anchor: more, title: 'Heading', args: [currentHeading()],
  }));
  side.body.append(more);
  subscriptions.push(
    side,
    commands.registerCommand('outline.copyLink', (heading: Heading) => copy(heading)),
    // any extension can add to the menu the same way
    window.registerMenuItem('outline/heading',
      { command: 'outline.copyLink', title: 'Copy link' }),
  );
}
```

*As buttons of your own:* `window.getMenuItems(menuId, context)` gives the entries that show in `context`, sorted, with title and icon filled in. Draw them as you like, run the chosen one with `commands.executeCommand(item.command, ...args)`, and draw again on `window.onDidChangeMenu` (an entry came or went) and whenever your context changes. The slash commands read the Visual editor's menus this way.

```ts
const render = () => toolbar.replaceChildren(
  ...window.getMenuItems('outline/toolbar').map((item) =>
    button(item.icon ?? item.title, () => commands.executeCommand(item.command))),
);
render();
subscriptions.push(window.onDidChangeMenu((id) => {
  if (id === 'outline/toolbar') render();
}));
```

Put the menu's id, where it shows, its context and its arguments into your extension's doc comment, so others know how to add to it.

== Side panels <architecture-extensions-side-panels>

`window.registerSidePanel(id, options)`.

```ts
activate({ window, subscriptions }) {
  const side = window.registerSidePanel('outline', { label: 'Outline', icon: ICON });
  side.body.textContent = 'Headings go here';
  subscriptions.push(side, side.onDidChangeVisibility(() => {
    if (side.visible) renderOutline(side.body);
  }));
}
```

- *Options:* `label`, `icon`, `side` (`left` or `right`), `alignment` on the rail (`top` or `bottom`), `order`.
- *The panel* also has `show()`, `dismiss()`, `visible`, `setDefault(open)`. Its key goes into `contributes.keybindings` for the command `workbench.view.<id>`.
- *One panel per side* is open at a time.

== Title bar and status bar items <architecture-extensions-status-bar>

`window.registerTitleBarItem(element, { alignment, priority })` and `window.registerStatusBarItem(element, { alignment, priority })`: an element of your own in the bar above everything (`left`, `center`, `right`) or below the editors (`left`, `right`). Within a side a higher `priority` sits further left. A bar shows while it has an item that is not `hidden`.

#figure(
  mermaid(read("../diagrams/title-bar.mmd"), width: 90%),
  caption: [The title bar's items by side and priority, as the built-in and collaboration extensions place them],
) <fig:title-bar>

```ts
activate({ window, subscriptions }) {
  const count = window.ownerDocument.createElement('span');
  subscriptions.push(
    window.registerStatusBarItem(count, { alignment: 'right', priority: 10 }),
  );
}
```

- *The window's own item:* "View" (the menu `window/view`), right, priority 100.
- *Buttons in the title bar look alike;* an item styles itself over that look.
- *Tint:* while an item's element has `data-background="warning"` or `"error"`, the whole title bar takes that color (VS Code's `StatusBarItem.backgroundColor`). Collaboration's guest mode does (@features-guest-access).

== Messages <architecture-extensions-messages>

`window.showInformationMessage(message, ...items)` (and `showWarningMessage`, `showErrorMessage`): a notification at the top right of the widget, just below the title bar and never over it, the newest on top (at most three). Information without items closes by itself after 8 s, not while the pointer or the focus is on it; warnings, errors and messages with items stay until closed.

With `{ modal: true, detail }` (VS Code's `MessageOptions`): a card over the whole widget, which takes no input meanwhile, with the items and Cancel (as VS Code's); Cancel and Escape resolve to `undefined`. Every yes/no about a destructive step asks this way: deleting a file, a big "Replace all", revoking a guest link. The `collaboration` extension's "You are not signed in" with "Sign in" too; it shows the card again after Cancel.

== Editors <architecture-extensions-editors>

`window.registerEditorProvider(viewType, provider, options)`: how files matching a pattern open in the editing area. Every editor is registered this way, the Visual and Source editor too.

```ts
activate({ window, subscriptions }) {
  subscriptions.push(window.registerEditorProvider('csvTable.editor', {
    resolveEditor({ content }, panel) {
      const text = typeof content === 'string'
        ? content : new TextDecoder().decode(content);
      panel.element.append(renderCsv(text));
    },
  }, { displayName: 'CSV table', filenamePattern: '*.csv', priority: 'option' }));
}
```

- *`priority`* when several editors match: a number (higher first), `default` (100), `option` (only when chosen, each time: never remembered for later opens), `fallback` (only files no other editor matches).
- *Several editors for one file* get a tab each; the one picked is remembered.
- *`panel`* has `element`, `visible`, `onDidChangeViewState`, `onDidRequestReveal`, `onDidDispose`. `retainContextWhenHidden` keeps the panel alive while another file or tab shows.

== File decorations <architecture-extensions-file-decorations>

`window.registerFileDecorationProvider(provider)`: a badge, tooltip and color for files in the file panel.

```ts
activate({ window, subscriptions }) {
  const changed = new EventEmitter<readonly ProjectPath[] | undefined>();
  subscriptions.push(window.registerFileDecorationProvider({
    provideFileDecoration: (path) =>
      (path.endsWith('.bib') ? { badge: 'B', tooltip: 'Bibliography' } : undefined),
    onDidChangeFileDecorations: changed.event, // fire with the paths, or undefined: all
  }));
}
```

== Search providers <architecture-extensions-search>

`window.registerSearchProvider(provider)`: a group of results in search everywhere (⌘P), found by a query or by typing its `prefix` first.

```ts
activate({ window, project, subscriptions }) {
  subscriptions.push(window.registerSearchProvider({
    id: 'todos', label: 'TODOs', prefix: '!', order: 65,
    provideItems: (query) => findTodos(project, query).map((todo) => ({
      label: todo.text,
      accept: () => window.showDocument(todo.path, { selection: todo.range }),
    })),
  }));
}
```

The built-in groups: Files `/`, Headings `#`, Labels and Figures `@`, Commands `>`, Styles `*`, Comments `!`, Settings `:`, Text `%`.

== Style sheets, editor header and footer <architecture-extensions-style-sheets>

`window.registerStyleSheet(css)`: the extension's own CSS, as a string of CSS (not a path or URL). The widget adds it where it renders (the page's `<head>`, or the shadow root of `<zwiebelfisch-editor>`), after its own stylesheet. `window.registerEditorHeaderFooter({ header, footer })`: elements above and below every editor (breadcrumbs, a pager).

```ts
import css from './word-count.css?inline'; // Vite: the file's contents as a string

activate({ window, subscriptions }) {
  subscriptions.push(
    window.registerStyleSheet(css),
    window.registerEditorHeaderFooter({ header: breadcrumbs, footer: pager }),
  );
}
```

- *Class names of your own* (`zwf-<extension>__…`), colors only from the `--zwf-*` tokens, so light and dark both work.
- *Without a bundler:* pass the CSS text itself, e.g. `` window.registerStyleSheet(`.zwf-word-count { color: var(--zwf-muted); }`) ``.

== File changes <architecture-extensions-workspace>

`workspace.applyEdit(change)`: create, update, rename or delete a file. Resolves to `null` once applied, or to the reason it was refused. Never call `project.apply`: the host page may veto.

```ts
activate({ commands, workspace, window, subscriptions }) {
  subscriptions.push(commands.registerCommand('notes.create', async () => {
    const path = ProjectPath.parse('/notes.typ')!;
    const problem = await workspace.applyEdit({ kind: 'create', path, content: '' });
    if (problem !== null) void window.showErrorMessage(problem);
  }));
}
```

Text edits of an open `.typ` file go to its `TypstDocument` (`change`, with the extension's own origin).

`workspace.registerFileSystemProvider({ stat })`: folders and files an extension makes read-only. While a provider's `stat(path)` (null: the top level) says `{ permissions: FilePermission.Readonly }`, `applyEdit` refuses:

#table(
  columns: (auto, 1fr),
  table.header[Readonly][`applyEdit` refuses],
  [a folder], [to create, rename or delete a file in it (its files' content stays editable)],
  [a file], [to change, rename or delete it; for a path not there yet, to create it],
)

The file panel keeps such rows where they are, and the text editor opens such a file read-only; `workspace.fs.stat(path)` reads it. The `collaboration` extension makes every folder but a GitLab room's own read-only, and, for a guest, every file of a type guests may not change.

== Document links <architecture-extensions-links>

`languages.registerDocumentLinkProvider(selector, provider)`: ranges of a text that lead somewhere: a project file, a place in it, or a URL. The `documentLinks` extension shows them in every editor (⌘-click). The selector picks texts by language (`{ language: 'typst' }`; `{}`: all), as for every `languages` provider.

```ts
activate({ languages, subscriptions }) {
  subscriptions.push(languages.registerDocumentLinkProvider({ language: 'typst' }, {
    provideDocumentLinks: ({ text }) => [...text.matchAll(/https:\S+/g)].map((m) => ({
      range: SourceRange.of({ from: m.index, to: m.index + m[0].length }),
      target: new URL(m[0]),
    })),
  }));
}
```

Costly parts (`target`, `tooltip`, `command`) may wait for `resolveDocumentLink`.

== Drop edits <architecture-extensions-drop>

`languages.registerDocumentDropEditProvider(selector, provider)`: what a project file dropped into a text becomes. The first provider that answers wins (by `priority`). A file from the computer is uploaded before the providers are called.

```ts
activate({ languages, subscriptions }) {
  subscriptions.push(languages.registerDocumentDropEditProvider({ language: 'typst' }, {
    provideDocumentDropEdits: (_document, _at, file) =>
      file.endsWith('.txt') ? { insertText: `#raw(read("${file}"))` } : null,
  }));
}
```

== Paste edits <architecture-extensions-paste>

`languages.registerDocumentPasteEditProvider(selector, provider, metadata)`: another way a paste can go in (offered in the "Paste as" chip), or a change to whatever goes in (`resolveDocumentPasteEdit`: add imports, rename a clashing label).

```ts
activate({ languages, subscriptions }) {
  subscriptions.push(languages.registerDocumentPasteEditProvider(
    { language: 'typst' }, {
    provideDocumentPasteEdits: (_document, _ranges, data) => {
      const text = data.getData('text/plain');
      if (!text) return undefined;
      const insertText = text.toUpperCase();
      return [{ title: 'Uppercase', kind: 'text.upper', insertText }];
    },
  }, { providedPasteEditKinds: ['text.upper'], pasteMimeTypes: ['text/plain'] }));
}
```

== Help sheets <architecture-extensions-help>

`languages.registerHelpSheet(selector, sheet)`: a cheat sheet in the Help panel while a file of that language is shown. Plain data; a row drags into the text or inserts at the cursor.

```ts
activate({ languages, subscriptions }) {
  subscriptions.push(languages.registerHelpSheet({ language: 'typst' }, {
    title: 'Callouts',
    sections: [{
      title: 'Boxes',
      rows: [{ snippet: '#callout[Note]', description: 'A box around the text' }],
    }],
  }));
}
```

== Import sources <architecture-extensions-import-sources>

`languages.registerImportSource(selector, { name, module })`: where a name comes from. Pasted text that uses the name gets the import (the `imports` extension), without knowing which extension declared it.

```ts
activate({ languages, subscriptions }) {
  subscriptions.push(languages.registerImportSource({ language: 'typst' },
    { name: 'mermaid', module: '@preview/merman:0.4.0' }));
}
```

== Source controls <architecture-extensions-scm>

`scm.registerSourceControl(sourceControl)`: somewhere the project can be committed. The `sourceControl` extension shows it in the title bar (its `statusBarItems` as the save status in the middle, "Save to …" at the right) and as file badges. Without `commit`, the user may not commit there (a guest's GitLab room): no "Save to …", the save status only shows.

```ts
activate({ scm, project, subscriptions }) {
  const changed = new EventEmitter<void>();
  subscriptions.push(scm.registerSourceControl({
    id: 'myGit', label: 'Git', busy: false, onDidChange: changed.event,
    commit: (message) => void pushToServer(project.files(), message),
  }));
}
```

*`quickDiffProvider`* (optional): `provideOriginalText(path)` gives a file's text at the last commit (`''`: added since; `undefined`: not this source control's). Fire `onDidChange` when it moves (a commit, a merge). The `changes` extension diffs the editors against it, or against a commit chosen in History, one baseline for all:

#figure(
  mermaid(read("../diagrams/quick-diff.mmd"), width: 90%),
  caption: [Changes since the last commit, or a chosen one],
) <fig:quick-diff>

*`historyProvider`* (optional, VS Code's proposed API): `provideHistoryItems({ scope, cursor, limit })` pages the commits (of a file or folder), `provideHistoryItemChanges(id)` the files one changed, `provideFileContent(id, path)` a file at a commit; fire `onDidChangeCurrentHistoryItem` when the current commit moves. The `changes` extension's History panel reads it, and takes a chosen commit's texts as the baseline instead of `quickDiffProvider`'s.

== Visual editor nodes <architecture-extensions-visual-editor>

`visualEditor.registerNode(spec)`: a Typst construct as a node (@architecture-data-model-nodes): its Tiptap node, which Lezer syntax nodes or Typst calls it reads, and its `toTypst`. Return `null` from a parse rule for anything you cannot write back exactly: it stays a raw box.

```ts
activate({ visualEditor, subscriptions }) {
  subscriptions.push(visualEditor.registerNode({
    name: 'heading',
    tiptap: Heading,
    typst: {
      parseTypst: {
        syntaxNodes: {
          Heading: { standsAlone: true, takesLabel: true, block: parseHeading },
        },
      },
      toTypst: (state, heading, pos) => {
        state.hidden(`${'='.repeat(heading.attrs.level)} `);
        state.textblock(heading, pos);
      },
      labelled: true,
    },
  }));
}
```

== Visual editor marks <architecture-extensions-marks>

`visualEditor.registerMark(spec)`: inline styling as a mark, with how it reads from and writes to Typst.

```ts
activate({ visualEditor, subscriptions }) {
  subscriptions.push(visualEditor.registerMark({
    name: 'underline', tiptap: Underline,
    typst: {
      parseTypst: { calls: { underline: { inline: parseUnderline } } },
      toTypst: () => ({ open: '#underline[', close: ']' }),
    },
  }));
}
```

== Tiptap extensions <architecture-extensions-tiptap>

`visualEditor.registerTiptapExtension(extension)`: plugins, decorations, keymaps and input rules not tied to a node; the same for every editor, or made per editor (a function of it).

```ts
activate({ visualEditor, subscriptions }) {
  subscriptions.push(visualEditor.registerTiptapExtension(TiptapExtension.create({
    name: 'typewriter',
    onSelectionUpdate() { this.editor.commands.scrollIntoView(); },
  })));
}
```

== Completion lists <architecture-extensions-completion>

`visualEditor.registerCompletionItemProvider(provider, trigger)`: a list that pops up while a trigger character and a query are typed (`@` for labels, `/` for the slash commands). The host filters the items by the query.

```ts
activate({ visualEditor, subscriptions }) {
  subscriptions.push(visualEditor.registerCompletionItemProvider({
    provideCompletionItems: () => EMOJI.map(({ name, char }) => ({
      label: name, detail: char,
      command: ({ tiptap, range }) =>
        tiptap.chain().focus().insertContentAt(range, char).run(),
    })),
  }, { char: ':' }));
}
```

== Highlights <architecture-extensions-highlights>

`visualEditor.registerHighlightProvider(provider)`: styled source ranges drawn over the text (errors, search matches, other users' selections), kept in place while the user types until the provider fires again.

```ts
activate({ visualEditor, subscriptions }) {
  const changed = new EventEmitter<TypstDocument>();
  subscriptions.push(visualEditor.registerHighlightProvider({
    provideHighlights: ({ text }) => [...text.matchAll(/TODO/g)].map((match) => ({
      ...SourceRange.of({ from: match.index, to: match.index + 4 }),
      className: 'zwf-todos__mark',
    })),
    onDidChangeHighlights: changed.event,
  }));
}
```

== Raw boxes <architecture-extensions-raw-boxes>

A raw box shows Typst source as fallback:

#table(
  columns: (auto, 1fr, 1fr),
  table.header[][`visualEditor.registerRawBoxRenderer`][`visualEditor.registerRawBoxBehavior`],
  [Does], [*draws* a picture in place of the box's code while it is not edited], [*adds* to every box: elements, listeners],
  [How many per box], [one: the first renderer by `priority` that `renders` the box], [all, in registration order (`null`: nothing for this box)],
  [Examples], [images (110), compiled snippets (100, `renderedBoxes`)], [an image's resize handles, a linked picture's click],
)

```ts
activate({ visualEditor, preview, project, subscriptions }) {
  subscriptions.push(
    visualEditor.registerRawBoxRenderer((editor) => ({
      renders: (node) => node.type.name === 'rawBlock',
      async render(node, from) {
        const path = project.pathOf(editor.document);
        const range = SourceRange.of({ from, to: from + node.attrs.src.length });
        const { text } = editor.document;
        const snippet = path && await preview.snippet(path, range, text);
        return snippet && { url: svgDataUrl(snippet.svg) };
      },
      onDidChange: preview.onDidRender,
    })),
    visualEditor.registerRawBoxBehavior((box) => {
      const badge = box.dom.ownerDocument.createElement('span');
      badge.textContent = 'Typst';
      box.dom.insertBefore(badge, box.code);
      return { dispose: () => badge.remove() };
    }),
  );
}
```

== CodeMirror extensions <architecture-extensions-source-editor>

`sourceEditor.registerCodeMirrorExtension(selector, extension)`: a CodeMirror extension for every CodeMirror the selector picks, open or made later: `editor: 'source'` (Source editors), `'rawBox'` (raw boxes' code), `'other'` (an extension's own, via `codeMirrorExtensionsFor`); `language` by language; `{}` all.

```ts
activate({ sourceEditor, subscriptions }) {
  subscriptions.push(
    sourceEditor.registerCodeMirrorExtension({ editor: 'source' },
      EditorView.lineWrapping),
    sourceEditor.registerCodeMirrorExtension({ language: 'typst' },
      (editor) => myLinter(editor.path)),
  );
}
```

== Preview view options <architecture-extensions-preview>

`preview.registerViewOption(option)`: a checkbox in the View menu that changes only what the preview shows. `apply` adds Typst lines (a prelude) before the main file; the documents stay untouched and exports never see it.

The preview compiles in its worker; extensions add every control (its toolbar is the menu `preview/toolbar`) and drive it: `reveal`, `onDidClickPage`, `boxesFor`, `snippet`, `setZoom`, `exportPdf`, `onDidChangeDiagnostics`, `onDidRender`.

```ts
activate({ preview, subscriptions }) {
  const OUTLINES = '#set block(stroke: red)';
  subscriptions.push(preview.registerViewOption({
    id: 'previewGuides.boxOutlines', label: 'Box outlines', default: false,
    apply: (entry, on) =>
      (on ? { ...entry, prelude: [...entry.prelude, OUTLINES] } : entry),
  }));
}
```

== PDF export options <architecture-extensions-pdf-options>

`preview.registerPdfExportOption(option)`: a checkbox in the "Download PDF" popover; `apply` changes the sources the PDF is compiled from.

```ts
activate({ preview, project, subscriptions }) {
  subscriptions.push(preview.registerPdfExportOption({
    id: 'comments.include', label: 'Include comments', default: false,
    apply: (entry, include) => (include ? entry : withoutComments(project, entry)),
  }));
}
```

== Preview renderers <architecture-extensions-renderers>

`preview.registerRenderer(renderer)`: another way to show the document. Once picked, the renderer gets Typst's HTML export instead of the pages.

```ts
activate({ preview, subscriptions }) {
  subscriptions.push(preview.registerRenderer({
    id: 'html', label: 'HTML', output: 'html',
    create: (container) => ({
      update: (bundle) => showHtml(container, bundle.files),
      dispose: () => container.replaceChildren(),
    }),
  }));
}
```

== Preview overlays <architecture-extensions-overlays>

`preview.registerPaneOverlay(element)`: an element over the whole preview pane (a loading note). `preview.createPageOverlay(className)`: boxes drawn over the pages, in page coordinates, so they follow zoom.

```ts
activate({ preview, subscriptions }) {
  const marks = preview.createPageOverlay('zwf-clicks__mark');
  subscriptions.push(
    preview.registerPaneOverlay(loadingNote),
    marks,
    // outline what was clicked
    preview.onDidClickPage((click) => marks.set(click.boxes)),
  );
}
```

== Competing contributions <architecture-extensions-rules>

Each kind has an explicit tie-breaker, so the result never depends on the list's order; registration order counts only within one extension.

#table(
  columns: 2,
  table.header[Contribution][Ordered by],
  [Menu items (toolbars and submenus too)], [`group` (`navigation` first, then by name), then `order`],
  [Visual editor floating bars], [`order`: the first with an anchor shows],
  [Title bar and status bar items], [`alignment`, then `priority` (higher further left)],
  [Raw box renderers, document links, drop and paste edits], [`priority`, default 100, higher first],
  [Editors], [the user's choice (a tab), then `priority`, then the most specific pattern],
  [Search providers' groups], [`order` (default 100, lower first), then `id`],
  [Visual editor nodes and marks], [their Tiptap extension's `priority` (default 100, higher first)],
  [Side panels' rail buttons], [`side`, then `alignment`, then `order`],
  [Source editor extensions], [CodeMirror's `Prec`],
)

== Built-in extensions <architecture-extensions-built-in>

`createEditor` activates them in this order (`builtinExtensions()` in `src/editor/editor.ts`). `devtools` wraps the final list and records every contribution in a side panel. `collaboration(options)` is exported but not in the list: a host page adds it.

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`codeEditing`], [the Source editors' basic setup, Tab indenting, wrapped lines; the look of every CodeMirror], [source editor],
  [`typstLanguage`], [Typst highlighting, the help sheet "Typst basics"; a dropped Typst file becomes `#include "…"`], [source editor, help, drop edit],
  [`imports`], [pasted Typst gets the imports it needs], [paste edit],
  [`markdown`], [Markdown pasted as Typst], [paste edit],
  [`wordProcessors`], [HTML from Word, Google Docs, LibreOffice cleaned before the Visual editor reads it], [Tiptap extension],
  [`documentLinks`], [every provider's document links shown and followed in every editor; file paths as links], [document links, source editor, Tiptap extension, raw box behavior],
  [`files`], [the file panel and its commands; the read-only fallback editor], [side panel, menus, editor, search],
  [`fileNavigation`], [previous / next file in reading order; Back / Forward], [editor header and footer, commands, keys],
  [`help`], [the side panel "Help" with the shown file's help sheets], [side panel, commands, menu],
  [`search`], [the side panel "Find in files", Replace with one Undo], [side panel, commands, keys, highlights, search],
  [`searchEverywhere`], [the quick pick over every search provider; its groups Commands and Settings], [quick pick, command, keys, search],
  [`spreadsheets`], [`.ic` in IronCalc, written also as `name.ic.gen.typ`], [editor, menus, languages, help, links, drop edit],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror], [editor, search, languages, help],
  [`diagrams`], [`.drawio.png` in diagrams.net], [editor, toolbar, links, drop edit],
  [`mermaid`], [Mermaid diagrams (`.mmd`, drawn by `@preview/merman`)], [toolbar, links, help, import source, drop edit],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to …" and the save status of the registered source controls], [title bar, file decorations],
  [`changes`], ["Show changes since last commit" (or since a commit chosen in History), inline in the Visual and the Source editor (`@codemirror/merge`), since when in the status bar; the History panel], [View menu, command, Tiptap extension, CodeMirror extension, status bar, side panel, `files/row`, style sheet],
  [`markup`], [strong, emphasis, underline, strike, highlight, links, inline code, code blocks, quotes], [nodes, marks, commands, menus, floating bar],
  [`math`], [math boxes; "Inline math", "Display math"], [Tiptap extension, toolbar],
  [`headings`], [headings; Heading 1–3 in the text style menu], [node, commands, menu, search],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar, floating bar],
  [`images`], [image boxes, "Insert image", pasted and dropped images, the image viewer], [node, toolbar, editor, drop edit],
  [`figures`], [`#figure(..)` around any `figureBody` node], [nodes, search],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [raw box renderer],
  [`outline`, `pageLayout`, `lists`, `alignment`], [`#outline(..)`; page breaks, rules; bulleted, numbered and task lists; `#align(..)`], [nodes, toolbar],
  [`blockHandle`], [the grip beside the block under the pointer], [Tiptap extension],
  [`blockGaps`], [the caret before or after a box], [Tiptap extension, style sheet],
  [`tabKeys`], [Tab and Shift+Tab stay in the text; Escape, then Tab leaves], [Tiptap extension],
  [`undoRedo`], [Undo and Redo buttons], [toolbar],
  [`clipboard`], [copy and paste as Typst; the "Paste as" chip], [paste edit, Tiptap extension, source editor, command],
  [`comments`], [margin notes with threads], [node, mark, command, PDF and view option, search],
  [`labels`], [label index, reference chips, label tags, the `@` list], [nodes, toolbar, completion, search, links, paste edit],
  [`styles`], [the project's `/// @style` declarations; "New style…"], [node, mark, commands, menus, search],
  [`invisibles`], ["Invisible characters" in the View menu], [Tiptap extension, source editor, menu, command],
  [`slashCommands`], [`/` lists the Insert, list, Align and text style menus], [completion],
  [`previewProgress`], [the preview's loading note and error message], [pane overlay],
  [`previewSync`], [the preview follows the cursor; a click selects the source], [menu, page overlay],
  [`previewControls`], [zoom, a button per renderer, a View menu entry per view option], [menus, commands],
  [`previewGuides`], [view options "Page guides", "Box outlines", "Block spacing"], [view options],
  [`previewHtml`], [the HTML renderer], [renderer],
  [`pdfExport`], ["Download PDF" with its options], [commands, menu, pane overlay],
)
