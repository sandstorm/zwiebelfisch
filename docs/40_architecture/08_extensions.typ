#import "/template.typ": unreviewed

= Extensions <architecture-extensions>

#unreviewed

Every feature is an extension in `src/extensions/<name>/`, the built-ins too; no host has built-in contributions. The host makes the list from the built-ins with `extensions: (builtinExtensions) => […]` (@configuration-embedding-extensions) and leaves one out by its id. The why: the doc comment of `Extension` in `src/hosts/workbench/workbench.ts`.

```ts
interface Extension {
  readonly id: string;                           // unique in the list, e.g. 'word-count'
  readonly contributes?: ExtensionContributions; // settings, commands, key bindings, languages: declared before any extension activates
  activate(context: ExtensionContext): void;     // registers what it adds, once
}
```

- *`activate` runs once*, in list order. Every `Disposable` goes into `context.subscriptions`; they are disposed with the editor, in reverse order.
- *Factories take no options* (`markup()`, `images()`): settings and `workbench.user` configure them. Only `collaboration(options)` takes the host's connection. Factories and independence: @architecture-conventions-api, @architecture-conventions-layers.
- *Command ids* are `<extension>.<name>` (`pdfExport.export`).
- *Every type an extension implements or declares* is exported from the package.

== Shape of an extension <architecture-extensions-shape>

```
extensions/<name>/
  <name>.ts       entry: the factory (images()) and the controller; activate() registers everything
  <name>.css      its own styles, registered with workbench.registerStyleSheet
  model/          pure: no DOM, no editor libraries
  workbench/ visual-editor/ source-editor/ preview/    one folder per host it contributes to
```

== Example: word count <architecture-extensions-example>

The words of the shown file in the status bar, with a setting for its label and a command the host can run.

```ts
import { createEditor, type Extension } from 'zwiebelfisch';

export function wordCount(): Extension {
  return {
    id: 'word-count',
    contributes: {
      configuration: {
        properties: { 'wordCount.label': { type: 'string', default: 'words', description: 'Shown after the number.' } },
      },
    },
    activate({ project, commands, window, workspace, workbench, subscriptions }) {
      const item = workbench.ownerDocument.createElement('span');
      const count = () => (window.activeTextEditor?.document.text ?? '').split(/\s+/).filter(Boolean).length;
      const show = () => {
        item.textContent = `${count()} ${workspace.getConfiguration('wordCount').get<string>('label')}`;
      };
      show();
      subscriptions.push(
        window.registerStatusBarItem(item, { alignment: 'right', priority: 100 }),
        window.onDidChangeActiveFile(show),
        project.onDidChangeFile(show),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('wordCount.label')) show();
        }),
        commands.registerCommand('wordCount.count', () => count()),
      );
    },
  };
}

const editor = createEditor(host, {
  source: '= Hello\n\nSome words here.',
  settings: { 'wordCount.label': 'Wörter' },
  extensions: (builtinExtensions) => [...builtinExtensions, wordCount()],
});
await editor.executeCommand<number>('wordCount.count'); // 5
```

== The extension context <architecture-extensions-context>

What `activate` gets (`ExtensionContext`):

#table(
  columns: 2,
  table.header[Member][What],
  [`globalState`, `workspaceState`], [Values the extension keeps (@architecture-workbench-state)],
  [`project`], [The files: `files()`, `paths()`, `document(path)`, `content(path)`, `onDidChangeFile` (@architecture-workbench-files)],
  [`commands`], [Commands by id, key bindings (@architecture-workbench-commands)],
  [`window`], [Messages, quick input, status bar, custom editors, file decorations, the active file and editor (@architecture-workbench-api)],
  [`workspace`], [`applyEdit`, settings (@architecture-workbench-settings)],
  [`workbench`], [The frame: `open`, side panels, menus, style sheets, dropped files, `user` (@architecture-workbench-api)],
  [`scm`], [Source controls (@architecture-workbench-scm)],
  [`languages`], [Document links, drop and paste edits, help sheets, the language of a file (@architecture-source-editor-links, @architecture-workbench-drop-edits, @architecture-workbench-help)],
  [`visualEditor`], [Nodes, marks, toolbar, boxes, highlights; experimental (@architecture-visual-editor-constructs)],
  [`sourceEditor`], [CodeMirror extensions, for the Source editors or shared by every CodeMirror (@architecture-source-editor-host)],
  [`preview`], [Toolbar items, PDF export options, reveal, clicks, diagnostics (@architecture-preview-contributions)],
)

== Settings <architecture-extensions-settings>

- *As VS Code's*: declare each in `contributes.configuration.properties` as `<section>.<key>`, with `type`, `default`, `description` and an optional `enum`.
- *Read* with `workspace.getConfiguration(section).get(key)` and follow `workspace.onDidChangeConfiguration`: the host may change values any time (`editor.updateSettings`).
- *A wrong value* (wrong type, outside `enum`) counts as unset; an undeclared setting is ignored. Both log a warning. An id declared twice is an error.

== Competing contributions <architecture-extensions-rules>

Each has an explicit tie-breaker; registration order counts only within one extension.

#table(
  columns: 2,
  table.header[Contribution][Ordered by],
  [Menu items, preview toolbar items], [`group` (by name, `navigation` first), then `order`],
  [Visual editor toolbar items], [their group's `order`, then the item's `order`],
  [Status bar items], [`alignment`, then `priority` (higher further left)],
  [Box renderers, document links, PDF export options], [`priority`, default 100, higher first],
  [Custom editors], [the user's choice (a tab), then `priority`, then the most specific pattern],
  [Search providers' groups], [`order` (default 100, lower first), then `id`],
  [Visual editor nodes and marks], [their Tiptap extension's `priority` (Tiptap's: default 100, higher first)],
  [Side panels' rail buttons], [`side`, then `alignment`, then `order`],
  [Source editor extensions], [CodeMirror's `Prec`],
)

== Five vocabularies <architecture-extensions-vocabularies>

Every name says whose it is: ours (VS Code-shaped, unprefixed: `registerCommand`, `onDidChange…`, `registerNode`, `TypstParseContext`), Tiptap's (`Node.create`, `priority`, `addProseMirrorPlugins`; ProseMirror only through Tiptap), CodeMirror's (`Extension`, `EditorView`), Lezer's with the grammar of codemirror-lang-typst (`SyntaxNode`, node names `FuncCall`, `Heading`; for parse rules), and the Typst language (what parse rules read and `toTypst` writes).

- *A member that takes a framework object names the framework* (`registerTiptapExtension`, `registerCodeMirrorExtension`). Framework types are never renamed.
- *Pinned versions are part of the API*: codemirror-lang-typst 0.6.0, Tiptap 3.31.
- *Take ProseMirror objects* (schema, state, transactions) from the editor, never from a copy of your own.

== Built-in extensions <architecture-extensions-built-in>

`createEditor` activates them in this order (`builtinExtensions()` in `src/editor/editor.ts`); `devtools` is not in the list: it wraps the final list, last, and records every contribution in a right side panel (@configuration-embedding-devtools).

=== The list <architecture-extensions-list>

#table(
  columns: (auto, 2fr, 1fr),
  table.header[Extension][What it adds][Through],
  [`codeEditing`], [the Source editors' basic setup (line numbers, undo, brackets, search), Tab indenting, wrapped lines; the look of every CodeMirror (`codeColors`)], [source editor, shared CodeMirror extension],
  [`typstLanguage`], [Typst highlighting, the help sheet "Typst basics"; a dropped Typst file becomes `#include "…"`], [source editor, help, drop edit],
  [`imports`], [pasted Typst gets the imports it needs (the copied file's, else the known ones)], [paste edit],
  [`markdown`], [Markdown pasted as Typst (`typst.markdown`, a small lossy converter); first where the text is surely Markdown, else in the "Paste as" chip], [paste edit],
  [`wordProcessors`], [HTML from Word, Google Docs, LibreOffice cleaned before the Visual editor reads it (lists, Office tags, empty paragraphs)], [Tiptap extension (`transformPastedHTML`)],
  [`documentLinks`], [every provider's document links shown and followed in every editor (hover, ⌘-click, Alt+Enter); file paths in Typst text as links; `documentLinks.createFile`], [document links, shared CodeMirror extension, Tiptap extension, raw box pictures, style sheet],
  [`files`], [the file panel (Alt+1 / ⌃1) and its commands, "Set as main file" among them; the read-only fallback editor], [side panel, menus, custom editor, search],
  [`search`], [the side panel "Find in files": text or regex in the project, current file or a folder; Replace mode with one Undo; matches highlighted in both editors; "Find in folder…"], [side panel, commands, keys, menu, highlights, search],
  [`fileNavigation`], ["← previous file" / "next file →" in reading order; Back / Forward over shown files], [editor frame, commands, key bindings],
  [`help`], [the side panel "Help" with the shown file's help sheets; rows drag or insert into the editor], [side panel, commands, menu, Tiptap extension],
  [`spreadsheets`], [`.ic` in IronCalc, written also as `name.ic.gen.typ`; "New spreadsheet…", "Insert spreadsheet"], [custom editor, menus, toolbar, languages, help, links, drop edit],
  [`textFiles`], [csv, json, yaml, toml, xml, bib, txt, md, mmd in CodeMirror], [custom editor, search, languages, help],
  [`diagrams`], [`.drawio.png` in diagrams.net; "New diagram…", "Insert diagram", "Edit diagram"], [custom editor, toolbar, links, drop edit],
  [`mermaid`], ["Insert Mermaid diagram" (a `.mmd` drawn by `@preview/merman`), "Edit diagram", "Mermaid basics"], [toolbar, links, help, known import, drop edit],
  [`diagnostics`], [errors underlined (Source), highlighted (Visual), counted in the status bar], [source editor, highlights, status bar],
  [`sourceControl`], ["Save to _label_…" and status bar entries for the registered source controls], [`editor/title`, status bar, file decorations],
  [`markup`], [strong, emphasis, underline, strike, highlight, links, inline code, code blocks, quotes, line breaks `\` (Shift+Enter)], [nodes, marks, toolbar, links],
  [`math`], [the closing `$` makes a math box; Insert → "Inline math", "Display math"], [Tiptap input rule, toolbar],
  [`headings`], [headings and their numbering], [node, text styles, search],
  [`tables`], [`#table(..)`, "Insert table", the table bar], [node, toolbar],
  [`images`], [image boxes, "Insert image", pasted and dropped images, the image viewer], [node, toolbar, custom editor, drop edit],
  [`figures`], [`#figure(..)` around any `figureBody` node], [nodes, search],
  [`renderedBoxes`], [raw boxes drawn as snippets from the preview], [box renderer],
  [`lists`, `pageLayout`, `outline`, `alignment`], [bulleted, numbered and task lists; page breaks, horizontal rules; `#outline(..)` as a box, "Table of contents"; `#align(..)[..]`, `#par(justify: ..)[..]`, the Align menu], [nodes, toolbar],
  [`blockHandle`], [the grip beside the block under the pointer (drag to move, click to select); the drop cursor], [Tiptap extension],
  [`tabKeys`], [Tab and Shift+Tab stay in the text: indent and outdent in code, a catch-all elsewhere; Escape, then Tab leaves], [Tiptap extension],
  [`undoRedo`], [the Visual editor toolbar's Undo and Redo buttons (the history and its keys are the host's)], [toolbar],
  [`comments`], [margin notes with threads in cards; PDF option `comments.include`, view option `comments.show`], [node, mark, command, PDF and view option, search],
  [`labels`], [`LabelIndex`, reference chips, label tags, the `@` list; pasted labels renamed], [nodes, toolbar, completion, search, links, paste edit],
  [`styles`], [`TypstStyleIndex` of the project's `/// @style` declarations; "New style…"], [node, mark, text styles, toolbar menu, search],
  [`invisibles`], ["Invisible characters" in the View menu, for every editor], [Tiptap decorations, shared CodeMirror extension, menu, command],
  [`slashCommands`], [`/` lists the Insert menu and the text styles; the hint "Type / for commands"], [completion, Tiptap decoration],
  [`previewProgress`], [the preview's loading note over its empty pane ("Loading the Typst compiler… 3.1 / 6.6 MB", "Compiling…", downloads); a compiler that cannot load or crashed as an error message], [`registerPaneOverlay`, `onDidLoad`, `onDidCrash`, `isEmpty`],
  [`previewSync`], [the preview follows the cursor and shades the selection; a click selects the source and is outlined], [preview toolbar, `reveal`, `createPageOverlay`, `boxesFor`, `onDidClickPage`],
  [`previewControls`], [zoom, page number (pages only); the switch "Pages | HTML" between the renderers, remembered per viewer; a View menu entry per view option], [preview toolbar, menu `view`, commands],
  [`previewHtml`], [the renderer `html`: Typst's HTML export page by page, following the cursor (@architecture-preview-renderers)], [renderer],
  [`previewGuides`], [view options "Page guides", "Box outlines", "Block spacing" (@architecture-extensions-guides)], [view options],
  [`pdfExport`], [`pdfExport.export` → Blob; "Download PDF" with the options popover], [command, preview toolbar],
)

=== Optional extension <architecture-extensions-optional>

`collaboration(options)` is exported, not in the list; a host adds it. It shares the project over #link("https://yjs.dev/")[Yjs] through the host's connection (the files; the main file too, except in GitLab rooms or when the host locked it), shows other users in every editor and registers a GitLab room's source control (@architecture-server). With a server, it joins as the user signed in there: the account is a status bar entry ("Sign in", or the name with "Sign out" in the menu `collaboration/account`), `collaboration.signIn` and `collaboration.signOut` are commands, and a room refused for being signed out offers to sign in (`SIGN_IN_REQUIRED`).

=== How they meet <architecture-extensions-meeting>

#table(
  columns: (auto, auto, auto),
  table.header[Contribution point][Provided by][Read by],
  [document links], [`documentLinks`, `labels`, `markup`, `diagrams`, `mermaid`], [`documentLinks` (in every editor)],
  [shared CodeMirror extensions], [`codeEditing`, `invisibles`, `documentLinks`], [the Source editors, raw boxes, `textFiles`],
  [file decorations], [`collaboration`, `sourceControl`], [`files`],
  [known imports], [`mermaid`], [`imports`],
  [paste edit providers], [`markdown`, `imports`, `labels`], [the Visual and Source editors (the "Paste as" chip)],
  [`contributes.languages`], [`textFiles`, `spreadsheets`; the workbench (`typst`)], [`textFiles`, `help`],
  [view options], [`previewGuides`, `comments`], [`previewControls`],
  [preview renderers], [`previewHtml`], [`previewControls`],
  [node group `figureBody`], [`images`, `tables`], [`figures`],
  [menu `explorer/context`], [`files`, `search`], [`files`],
)

== Page guides and box outlines <architecture-extensions-guides>

`previewGuides`: see the module comment in `preview-guides.ts` and @architecture-preview-view.
