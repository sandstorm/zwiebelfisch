#import "../template.typ": mermaid, unreviewed

= Extensions <architecture-extensions>

#unreviewed

Every feature is an extension in `src/extensions/<name>/`, the built-ins too: hosts are only the mechanism of a view and contribute nothing of their own. Each following chapter ends with "How extensions hook in": what its host lets an extension register.

== The principle <architecture-extensions-principle>

An extension is `{ id, contributes, activate(context) }`: `contributes` declares settings, commands, keys and languages up front; `activate` registers everything else and pushes each registration into `context.subscriptions`.

```ts
// simplified from src/extensions/invisibles/invisibles.ts
const TOGGLE = 'invisibles.toggle';

export function invisibles(): Extension {
  return {
    id: 'invisibles',
    contributes: {
      configuration: {
        properties: {
          'invisibles.show': { type: 'boolean', default: false, description: '…' },
        },
      },
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
        window.registerMenuItem('view', {
          command: TOGGLE, title: 'Invisible characters', toggled: () => shown,
        }),
        commands.registerCommand(TOGGLE, () => show(!shown)),
        new Disposable(() => marks?.dispose()),
      );
    },
  };
}

// the host page: the built-ins, this one in place of the built-in `invisibles`
const mine = invisibles();
createEditor(host, {
  extensions: (builtins) => [...builtins.filter((e) => e.id !== mine.id), mine],
});
```

- *One list:* `createEditor({ extensions })` gets the built-ins in their order and returns the list to run: add, leave out by id, or replace (@configuration-embedding-extensions). An id listed twice throws.
- *Order:* every extension's `contributes` is declared first, so all settings, commands and keys are readable during activation; then each `activate` runs once, in list order, before any editor exists; on dispose, the extensions in reverse list order, each one's subscriptions in reverse.
- *Factories take no options* (`markup()`, `images()`): settings and `window.user` configure them, so a host page configures every extension the same way. Only `collaboration(options)` takes the host's connection.
- *Ids:* command ids are `<extension>.<name>` (`pdfExport.export`), settings `<section>.<key>` in the extension's section.
- *Extensions never import each other;* they meet at contribution points (@architecture-extensions-meeting). Every type an extension implements or declares is exported from the package.

== What `activate` gets <architecture-extensions-context>

`ExtensionContext` holds VS Code's namespaces plus the hosts of the editors and the preview; what is registered there applies to every editor created later.

#table(
  columns: 2,
  table.header[Member][What it is],
  [`commands`], [commands by id and their key bindings],
  [`window`], [what the user sees: the shown file, menus, side panels, status bar, custom editors, messages, style sheets],
  [`workspace`], [settings (`getConfiguration`) and the project's changes (`applyEdit`)],
  [`languages`], [document links of texts by their language],
  [`scm`], [the source controls],
  [`visualEditor`], [nodes, marks, toolbar items, box renderers and Tiptap extensions for every Visual editor],
  [`sourceEditor`], [CodeMirror extensions for every Source editor],
  [`preview`], [the preview's toolbar, PDF export options, reveal and clicks, compile results],
  [`project`], [the files, one `TypstDocument` per `.typ` file],
  [`subscriptions`], [disposed with the widget],
  [`globalState`, `workspaceState`], [values kept per viewer (`localStorage`) or per project and browser session (`sessionStorage`), scoped by the extension's id],
)

== Extension host <architecture-extensions-host>

`src/hosts/extension-host/` runs the extensions (VS Code's extension host) and holds `workspace/` (settings and file changes). `Widget` (`src/editor/widget/`) makes and wires the hosts.

#figure(
  mermaid(read("../diagrams/widget-composition.mmd"), width: 100%),
  caption: [What `createEditor` composes.],
)

- *Dispose order:* the extensions first, then the hosts: what came later, and may depend on what came before, goes first.
- *CSS order:* the frame's, the hosts', then the extensions' (`window.registerStyleSheet`).
- *Without storage* (blocked, private window) `globalState` and `workspaceState` keep nothing and nothing fails.

== Shape of an extension <architecture-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller (activate)
  <name>.css      its own styles, registered with window.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  window/ visual-editor/ source-editor/ preview/
                  one folder per host it contributes to
```

A host folder's part is a plain function that `activate` calls and that returns a `Disposable` (labels' `registerReferences`), not an extension of its own.

== Settings <architecture-extensions-settings>

A setting is a `ConfigurationProperty` (JSON Schema's `type`, `default`, `enum`, `description`) in `contributes.configuration`, read with `workspace.getConfiguration(section).get(key)`.

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

#figure(
  mermaid(read("../diagrams/extensions-vocabularies.mmd"), width: 70%),
  caption: [Every name says whose it is; ours are unprefixed, ProseMirror only through Tiptap.],
)

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
  [`fileNavigation`], [previous / next file in reading order; Back / Forward over shown files], [editor frame, commands, key bindings],
  [`help`], [the side panel "Help" with the shown file's help sheets], [side panel, commands, menu, Tiptap extension],
  [`search`], [the side panel "Find in files", Replace with one Undo, matches highlighted in both editors], [side panel, commands, keys, menu, highlights, search],
  [`searchEverywhere`], [the quick pick over every search provider; its groups Commands and Settings], [`createQuickPick`, `getSearchProviders`, command, keys, menu `workbench/rail/left`, search],
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
  [`outline`, `pageLayout`, `lists`, `alignment`], [`#outline(..)`; page breaks, horizontal rules; bulleted, numbered and task lists; `#align(..)`, `#par(justify: ..)`], [nodes, toolbar],
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
  [`previewGuides`], [view options "Page guides", "Box outlines", "Block spacing" (@architecture-preview-view)], [view options],
  [`previewHtml`], [the renderer `html` (@architecture-preview-renderers)], [renderer],
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
