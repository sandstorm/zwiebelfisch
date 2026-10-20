#import "../template.typ": api, mermaid, unreviewed

= Extensions <architecture-extensions>

#unreviewed

Every feature is an extension in `src/extensions/<name>/`, the built-ins too; no host has contributions of its own. The host page makes the list from the built-ins (`extensions: (builtinExtensions) => […]`, @configuration-embedding-extensions) and leaves one out by its id.

#api("/src/hosts/extension-host/extension-host.ts", "Extension")
#api("/src/hosts/extension-host/extension-host.ts", "ExtensionContributions", docs: "first-sentence")
#api("/src/hosts/extension-host/extension-host.ts", "ExtensionContext", docs: "first-sentence")

- *Factories take no options* (`markup()`, `images()`): settings and `window.user` configure them, so a host page configures every extension the same way. Only `collaboration(options)` takes the host's connection. Independence: @architecture-conventions-api, @architecture-conventions-layers.
- *Ids:* command ids are `<extension>.<name>` (`pdfExport.export`), settings `<section>.<key>` in the extension's section.
- *Every type an extension implements or declares* is exported from the package.

== Extension host <architecture-extensions-host>

`src/hosts/extension-host/` runs the extensions (VS Code's extension host). `Widget` (`src/editor/widget/`) makes and wires the hosts and hands them to it; `createEditor` makes the widget.

#figure(
  mermaid(read("../diagrams/widget-composition.mmd"), width: 85%),
  caption: [What `createEditor` composes.],
)

+ The widget makes every host (the window builds the frame) and adds their CSS, the frame's first.
+ `activate(list)` declares every extension's `contributes` (settings, languages, commands, keys) before any activates, so all are readable during activation; an id listed twice throws.
+ Extensions activate in list order.
+ The main file is shown and compiled; views are created on demand.
+ `dispose()` disposes the extensions in reverse order, each one's subscriptions in reverse, then the frame: what came later, and may depend on what came before, goes first.

=== Memento <architecture-extensions-state>

#api("/src/hosts/extension-host/extension-host.ts", "Memento")

`StorageMemento` keeps `globalState` in `localStorage` and `workspaceState` in `sessionStorage`, scoped by the extension's id.

== Shape of an extension <architecture-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller; activate() registers everything
  <name>.css      its own styles, registered with window.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  window/ visual-editor/ source-editor/ preview/    one folder per host it contributes to
```

A host folder's part is a plain function the entry's `activate` calls (`registerReferences(visualEditor, options)` returns its `Disposable`), not an extension of its own.

== Example: word count <architecture-extensions-example>

The words of the shown file in the status bar, with a setting for its label and a command the host can run.

```ts
export function wordCount(): Extension {
  return {
    id: 'word-count',
    contributes: {
      configuration: { properties: { 'wordCount.label': { type: 'string', default: 'words', description: 'Shown after the number.' } } },
      commands: [{ command: 'wordCount.count', title: 'Count words' }],
      keybindings: [{ command: 'wordCount.count', key: 'Mod+Alt+KeyW' }],
    },
    activate({ project, commands, window, workspace, subscriptions }) {
      const item = window.ownerDocument.createElement('span');
      const count = () => (window.activeTextEditor?.document.text ?? '').split(/\s+/).filter(Boolean).length;
      const show = () => { item.textContent = `${count()} ${workspace.getConfiguration('wordCount').get<string>('label')}`; };
      show();
      subscriptions.push(
        window.registerStatusBarItem(item, { alignment: 'right', priority: 100 }),
        window.onDidChangeActiveFile(show),
        project.onDidChangeFile(show),
        workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration('wordCount.label')) show(); }),
        commands.registerCommand('wordCount.count', () => count()),
      );
    },
  };
}

const editor = createEditor(host, { source: '= Hello\n\nSome words here.', extensions: (builtins) => [...builtins, wordCount()] });
await editor.executeCommand<number>('wordCount.count'); // 5
```

== Settings <architecture-extensions-settings>

#api("/src/hosts/workspace/workspace.ts", "ConfigurationProperty")

- *Follow `workspace.onDidChangeConfiguration`:* the host may change values any time (`editor.updateSettings`), and so may the user (search everywhere's Settings, `update`).
- *A wrong value* (wrong type, outside `enum`) counts as unset, an undeclared setting is ignored, both with a warning: a host page's typo never breaks an extension. An id declared twice is an error.

== Competing contributions <architecture-extensions-rules>

Each has an explicit tie-breaker, so the result never depends on the list's order; registration order counts only within one extension.

#table(
  columns: 2,
  table.header[Contribution][Ordered by],
  [Menu items (the Visual editor's and the preview's toolbars and submenus too)], [`group` (`navigation` first, then by name), then `order`],
  [Visual editor floating bars], [`order`: the first with an anchor shows],
  [Status bar items], [`alignment`, then `priority` (higher further left)],
  [Box renderers, document links, drop and paste edits, PDF export options], [`priority`, default 100, higher first],
  [Custom editors], [the user's choice (a tab), then `priority`, then the most specific pattern],
  [Search providers' groups], [`order` (default 100, lower first), then `id`],
  [Visual editor nodes and marks], [their Tiptap extension's `priority` (default 100, higher first)],
  [Side panels' rail buttons], [`side`, then `alignment`, then `order`],
  [Source editor extensions], [CodeMirror's `Prec`],
)

== Five vocabularies <architecture-extensions-vocabularies>

Every name says whose it is: ours (VS Code-shaped, unprefixed: `registerCommand`, `onDidChange…`, `registerNode`), Tiptap's (`Node.create`, `priority`; ProseMirror only through Tiptap), CodeMirror's (`Extension`, `EditorView`), Lezer's with codemirror-lang-typst's grammar (`SyntaxNode`, `FuncCall`; for parse rules), and the Typst language (what parse rules read and `toTypst` writes).

- *A member that takes a framework object names the framework* (`registerTiptapExtension`, `registerCodeMirrorExtension`); framework types are never renamed.
- *Pinned versions are part of the API:* codemirror-lang-typst 0.6.0, Tiptap 3.31.
- *Take ProseMirror objects* (schema, state, transactions) from the editor, never from a copy of your own.

== Built-in extensions <architecture-extensions-built-in>

`createEditor` activates them in this order (`builtinExtensions()` in `src/editor/editor.ts`). `devtools` is not in the list: it wraps the final list and records every contribution in a right side panel (@configuration-embedding-devtools).

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`codeEditing`], [the Source editors' basic setup, Tab indenting, wrapped lines; the look of every CodeMirror (`codeColors`)], [source editor],
  [`typstLanguage`], [Typst highlighting, the help sheet "Typst basics"; a dropped Typst file becomes `#include "…"`], [source editor, help, drop edit],
  [`imports`], [pasted Typst gets the imports it needs (the copied file's, else the known ones)], [paste edit],
  [`markdown`], [Markdown pasted as Typst (`typst.markdown`): first where the text is surely Markdown, else in "Paste as"], [paste edit],
  [`wordProcessors`], [HTML from Word, Google Docs, LibreOffice cleaned before the Visual editor reads it], [Tiptap extension (`transformPastedHTML`)],
  [`documentLinks`], [every provider's document links shown and followed in every editor; file paths in Typst as links], [document links, source editor, Tiptap extension, raw box pictures, style sheet],
  [`files`], [the file panel and its commands; the read-only fallback editor], [side panel, menus, custom editor, search],
  [`search`], [the side panel "Find in files", Replace with one Undo, matches highlighted in both editors], [side panel, commands, keys, menu, highlights, search],
  [`searchEverywhere`], [the quick pick over every search provider; its groups Commands and Settings], [`createQuickPick`, `getSearchProviders`, command, keys, menu `workbench/rail/left`, search],
  [`fileNavigation`], [previous / next file in reading order; Back / Forward over shown files], [editor frame, commands, key bindings],
  [`help`], [the side panel "Help" with the shown file's help sheets], [side panel, commands, menu, Tiptap extension],
  [`spreadsheets`], [`.ic` in IronCalc, written also as `name.ic.gen.typ`], [custom editor, menus, toolbar, languages, help, links, drop edit],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror], [custom editor, search, languages, help],
  [`diagrams`], [`.drawio.png` in diagrams.net; "New diagram…", "Insert diagram", "Edit diagram"], [custom editor, toolbar, links, drop edit],
  [`mermaid`], ["Insert Mermaid diagram" (a `.mmd` drawn by `@preview/merman`), "Edit diagram", "Mermaid basics"], [toolbar, links, help, known import, drop edit],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" and status bar entries for the registered source controls], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, underline, strike, highlight, links, inline code, code blocks, quotes, line breaks], [nodes, marks, commands, menus, floating bar, links],
  [`math`], [math boxes (the closing `$`); "Inline math", "Display math"], [Tiptap input rule, toolbar],
  [`headings`], [headings and their numbering; Heading 1–3 in the text style menu], [node, commands, menu `visualEditor/textStyle`, search],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", pasted and dropped images, the image viewer], [node, toolbar, custom editor, drop edit],
  [`figures`], [`#figure(..)` around any `figureBody` node], [nodes, search],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`lists`, `pageLayout`, `outline`, `alignment`], [bulleted, numbered and task lists; page breaks, horizontal rules; `#outline(..)`; `#align(..)`, `#par(justify: ..)`], [nodes, toolbar],
  [`blockHandle`], [the grip beside the block under the pointer; the drop cursor], [Tiptap extension],
  [`blockGaps`], [the caret before or after a box; typing there makes a paragraph], [Tiptap extension, style sheet],
  [`tabKeys`], [Tab and Shift+Tab stay in the text; Escape, then Tab leaves], [Tiptap extension],
  [`undoRedo`], [the Visual editor toolbar's Undo and Redo buttons], [toolbar],
  [`clipboard`], [copy and paste as Typst through the paste edit providers; the "Paste as" chip, `editor.action.pasteAs`], [paste edit, Tiptap extension, source editor, command, style sheet],
  [`comments`], [margin notes with threads; PDF option `comments.include`, view option `comments.show`], [node, mark, command, PDF and view option, search],
  [`labels`], [`LabelIndex`, reference chips, label tags, the `@` list; pasted labels renamed], [nodes, toolbar, completion, search, links, paste edit],
  [`styles`], [`TypstStyleIndex` of the project's `/// @style` declarations; "New style…"], [node, mark, commands and entries per style (text style menu, Styles submenu), search],
  [`invisibles`], ["Invisible characters" in the View menu, for every editor], [Tiptap decorations, source editor, menu, command],
  [`slashCommands`], [`/` lists the Insert, list, Align and text style menus (`window.getMenuItems`)], [completion, Tiptap decoration],
  [`previewProgress`], [the preview's loading note and its error message (@architecture-window-loading)], [`registerPaneOverlay`, `onDidLoad`, `onDidCrash`, `isEmpty`],
  [`previewSync`], [the preview follows the cursor and shades the selection; a click selects the source], [menu `preview/title` ("Follow cursor"), `reveal`, `createPageOverlay`, `boxesFor`, `onDidClickPage`],
  [`previewControls`], [zoom, page number, a button per renderer, a View menu entry per view option], [menus `preview/title` and `view`, commands, status bar],
  [`previewHtml`], [the renderer `html` (@architecture-preview-renderers)], [renderer],
  [`previewGuides`], [view options "Page guides", "Box outlines", "Block spacing" (@architecture-preview-view)], [view options],
  [`pdfExport`], [`pdfExport.export` → Blob; "Download PDF" with the options popover], [commands, menu `preview/title`, pane overlay],
)

`collaboration(options)` is exported, not in the list; a host adds it. It shares the project over #link("https://yjs.dev/")[Yjs] through the host's connection (the main file too, except in GitLab rooms or when the host locked it), shows other users in every editor and registers a GitLab room's source control (@architecture-server). With a server it joins as the user signed in there; signed out it does not connect but offers to sign in.

=== How they meet <architecture-extensions-meeting>

Extensions never import each other; they meet at contribution points, so leaving one out leaves the others working.

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks`, `labels`, `markup`, `diagrams`, `mermaid`], [`documentLinks` (in every editor)],
  [CodeMirror extensions for `{}` or a language], [`codeEditing`, `invisibles`, `documentLinks`, `typstLanguage`], [the Source editors, raw boxes, `textFiles`],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [known imports], [`mermaid`], [`imports`],
  [paste edit providers], [`clipboard`, `markdown`, `imports`, `labels`], [`clipboard`],
  [`contributes.languages`], [`textFiles`, `spreadsheets`; the widget (`typst`)], [`textFiles`, `help`],
  [view options], [`previewGuides`, `comments`], [`previewControls`],
  [preview renderers], [`previewHtml`], [`previewControls`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `explorer/context`], [`files`, `search`], [`files`],
  [search providers], [`files`, `headings`, `labels`, `figures`, `styles`, `comments`, `textFiles`, `search`, `searchEverywhere`], [`searchEverywhere`],
)
