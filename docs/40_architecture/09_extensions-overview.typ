= Extensions overview <architecture-extensions-overview>

Every feature of the editor is an extension, the built-in ones too. An extension is an object:

```ts
interface TypstExtension {
  readonly id: string;                           // unique in the list, e.g. 'word-count'
  readonly contributes?: ExtensionContributions; // its settings, commands and languages, declared before any extension activates
  activate(context: ExtensionContext): void;     // registers what it adds, once
}
```

- *`activate` runs once*, in list order. Push every `Disposable` it gets into `context.subscriptions`; they are disposed with the editor, in reverse order.
- *Write a factory* (`wordCount()`), as every built-in does, so it can take options later.
- *Every type an extension implements or declares* is exported from the package.

== Adding, leaving out, replacing <architecture-extensions-overview-list>

The host makes the list from the built-ins with `extensions: (builtinExtensions) => […]` (@configuration-embedding-extensions); leave one out by its id (@architecture-built-in-extensions).

== Example: word count <architecture-extensions-overview-example>

The words of the shown file in the status bar, with a setting for its label and a command the host can run.

```ts
import { createTypstEditor, type TypstExtension } from 'typst-editor';

export function wordCount(): TypstExtension {
  return {
    id: 'word-count',
    contributes: {
      configuration: {
        properties: {
          'wordCount.label': { type: 'string', default: 'words', description: 'Shown after the number.' },
        },
      },
    },
    activate({ project, commands, window, workspace, workbench, subscriptions }) {
      const item = workbench.ownerDocument.createElement('span');
      const count = () => {
        const text = window.activeTextEditor?.document.text ?? '';
        return text.split(/\s+/).filter(Boolean).length;
      };
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

const editor = createTypstEditor(host, {
  source: '= Hello\n\nSome words here.',
  settings: { 'wordCount.label': 'Wörter' },
  extensions: (builtinExtensions) => [...builtinExtensions, wordCount()],
});
await editor.executeCommand<number>('wordCount.count'); // 5
```

== The extension context <architecture-extensions-overview-context>

What `activate` gets (`ExtensionContext`):

#table(
  columns: 3,
  [Member], [What], [Details],
  [`subscriptions`], [Registrations, disposed with the editor], [],
  [`globalState`, `workspaceState`], [Values the extension keeps], [@architecture-workbench-api-state],
  [`project`], [The files: `files()`, `paths()`, `document(path)`, `content(path)`, `onDidChangeFile`], [@architecture-workbench-api-files],
  [`commands`], [Commands by id, key bindings], [@architecture-workbench-api-commands],
  [`window`], [Messages, quick input, status bar, custom editors, file decorations, the active file and editor], [@architecture-workbench-api],
  [`workspace`], [`applyEdit`, settings], [@architecture-workbench-api-settings],
  [`workbench`], [The frame: `open`, side panels, menus, style sheets, dropped files, `user`], [@architecture-workbench-api],
  [`scm`], [Source controls], [@architecture-workbench-api-scm],
  [`languages`], [Document links, drop and paste edits, help sheets, the language of a file], [@architecture-source-editor-and-preview-links, @architecture-workbench-api-drop-edits, @architecture-workbench-api-help],
  [`visualEditor`], [Nodes, marks, toolbar, boxes, highlights (experimental)], [@architecture-visual-editor-constructs],
  [`sourceEditor`], [CodeMirror extensions: for the Source editors, and shared ones for every CodeMirror], [@architecture-source-editor-and-preview],
  [`preview`], [Toolbar items, PDF export options, reveal, clicks, diagnostics], [@architecture-source-editor-and-preview-preview],
)

== Settings <architecture-extensions-overview-settings>

Settings work as VS Code's (see the example above):

- *Declare* each in `contributes.configuration.properties` as `<section>.<key>`, with `type`, `default`, `description` and an optional `enum`.
- *Read* with `workspace.getConfiguration(section).get(key)`, and follow `workspace.onDidChangeConfiguration`: the host may change values any time (`editor.updateSettings`).
- *A wrong value* (wrong type, outside `enum`) counts as unset; an undeclared setting is ignored. Both log a warning. An id declared twice is an error.

== Rules <architecture-extensions-overview-rules>

- *Extensions never depend on each other.* What one offers another goes through a generic contribution point (document links, file decorations, source controls) or a command id, never an import.
- *Command ids* are `<extension>.<name>` (`pdfExport.export`).
- *Rank competing contributions* with a `priority` or a `group` + `order`. Registration order counts only within one extension.

#table(
  columns: 2,
  [Contribution], [Ordered by],
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

== Five vocabularies <architecture-extensions-overview-vocabularies>

An extension meets up to five vocabularies; every name says whose it is.

#table(
  columns: 3,
  [Vocabulary], [Names look like], [Where],
  [Ours (VS Code-shaped, unprefixed)], [`registerCommand`, `onDidChange…`, `Disposable`, `getConfiguration`, `registerNode`, `TypstParseContext`], [The whole extension API],
  [Tiptap (ProseMirror only through Tiptap)], [`Node.create`, `priority`, `addProseMirrorPlugins`, `ChainedCommands`], [Visual editor nodes, marks, toolbar commands],
  [CodeMirror], [`Extension`, `EditorView`], [Source editor, code of raw boxes],
  [Lezer + the Typst grammar of codemirror-lang-typst], [`SyntaxNode`; node names `FuncCall`, `Heading`, `Strong`], [Parse rules of Visual editor constructs],
  [The Typst language], [`#callout(title: "Tip")[…]`], [What parse rules read and `toTypst` writes],
)

- *A member that takes a framework object names the framework*: `registerTiptapExtension`, `registerCodeMirrorExtension`. Framework types are never renamed.
- *Pinned versions are part of the API*: codemirror-lang-typst 0.6.0 and Tiptap 3.31.
- *Take ProseMirror objects* (schema, state, transactions) from the editor, never from a copy of your own.
