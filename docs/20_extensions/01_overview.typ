= Extensions overview <extensions-overview>

Every feature of the editor is an extension, the built-in ones too. An extension is an object:

```ts
interface TypstExtension {
  readonly id: string;                           // unique in the list, e.g. 'word-count'
  readonly contributes?: ExtensionContributions; // its settings, declared before any extension activates
  activate(context: ExtensionContext): void;     // registers what it adds, once
}
```

- `activate` runs once, in list order. Everything it registers returns a `Disposable`; push each into `context.subscriptions`.
- The editor disposes `subscriptions` on `dispose`, in reverse order.
- Write an extension as a function that makes it (`wordCount()`), as every built-in is, so it can take options later.
- Every type an extension implements or declares is exported from the package. What it only reaches through its context (`Project`, `TypstDocument`) is typed without an import.

== Adding, leaving out, replacing <extensions-overview-list>

The host makes the list from the built-ins with `extensions: (builtinExtensions) => […]` (@guide-embedding-extensions). The built-in ids: @architecture-built-in-extensions.

== Example: word count <extensions-overview-example>

The words of the shown file in the status bar, a setting for its label, a command the host can run.

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

== The extension context <extensions-overview-context>

What `activate` gets (`ExtensionContext`):

#table(
  columns: 3,
  [Member], [What], [Details],
  [`subscriptions`], [Registrations, disposed with the editor], [],
  [`globalState`, `workspaceState`], [Values the extension keeps], [@extensions-workbench-api-state],
  [`project`], [The files: `files()`, `paths()`, `document(path)`, `content(path)`, `onDidChangeFile`], [@extensions-workbench-api-files],
  [`commands`], [Commands by id, key bindings], [@extensions-workbench-api-commands],
  [`window`], [Messages, quick input, status bar, custom editors, file decorations, the active file and editor], [@extensions-workbench-api],
  [`workspace`], [`applyEdit`, settings], [@extensions-workbench-api-settings],
  [`workbench`], [The frame: `open`, side panels, menus, style sheets, dropped files, `user`], [@extensions-workbench-api],
  [`scm`], [Source controls], [@extensions-workbench-api-scm],
  [`languages`], [Document links in texts, by language], [@extensions-source-view-and-preview-links],
  [`visualView`], [Nodes, marks, toolbar, boxes, gutters, highlights (experimental)], [@extensions-visual-view-constructs],
  [`sourceView`], [CodeMirror extensions], [@extensions-source-view-and-preview],
  [`preview`], [Toolbar items, PDF export options, reveal, clicks, diagnostics], [@extensions-source-view-and-preview-preview],
)

== Settings <extensions-overview-settings>

- Declare each setting in `contributes.configuration.properties`, by full id `<section>.<key>` under the extension's own section.
- A `ConfigurationProperty` has `type`, `default`, `description` and an optional `enum`.
- The host sets values with `createTypstEditor({ settings })` and changes them later through `editor.settings`.
- Read with `workspace.getConfiguration(section).get(key)`.
- Follow `workspace.onDidChangeConfiguration`: the host may change values at any time.
- A value of the wrong type, or outside `enum`, counts as unset. A value for an undeclared setting is ignored. Both log a console warning.
- An id declared twice is an error.

== Rules <extensions-overview-rules>

- *Extensions never depend on each other.* What one offers another goes through a generic contribution point (document links, file decorations, source controls) or a command id, never an import.
- *Command ids* are `<extension>.<name>` (`pdfExport.export`).
- *Rank competing contributions* with a `priority` or a `group` + `order`:

#table(
  columns: 2,
  [Contribution], [Ordered by],
  [Menu items, preview toolbar items], [`group` (by name, `navigation` first), then `order`],
  [Visual view toolbar items], [their group's `order`, then the item's `order`],
  [Status bar items], [`alignment`, then `priority` (higher further left)],
  [Box renderers, document links, PDF export options], [`priority`, default 100, higher first],
  [Custom editors], [the user's choice (a tab), then `priority`, then the most specific pattern],
  [Search providers' groups], [`order` (default 100, lower first), then `id`],
  [Visual view nodes and marks], [their Tiptap extension's `priority` (Tiptap's: default 100, higher first)],
)

Equal ranks fall back to registration order, which counts only within one extension: never rely on it across extensions.

== Five vocabularies <extensions-overview-vocabularies>

An extension meets up to five vocabularies. Every name says whose it is:

#table(
  columns: 3,
  [Vocabulary], [Names look like], [Where],
  [Ours (VS Code-shaped, unprefixed)], [`registerCommand`, `onDidChange…`, `Disposable`, `getConfiguration`, `registerNode`, `TypstParseContext`], [The whole extension API],
  [Tiptap (ProseMirror only through Tiptap)], [`Node.create`, `priority`, `addProseMirrorPlugins`, `ChainedCommands`], [Visual view nodes, marks, toolbar commands],
  [CodeMirror], [`Extension`, `EditorView`], [Source view, code of raw boxes],
  [Lezer + the Typst grammar of codemirror-lang-typst], [`SyntaxNode`; node names `FuncCall`, `Heading`, `Strong`], [Parse rules of Visual view constructs],
  [The Typst language], [`#callout(title: "Tip")[…]`], [What parse rules read and `toTypst` writes],
)

- A member that takes or returns a framework object names the framework: `registerTiptapExtension`, `registerCodeMirrorExtension`.
- Framework types are used as they are, never renamed.
- Pinned versions are part of the API: *codemirror-lang-typst 0.6.0* (its syntax node names are those of Typst's `typst-syntax` crate) and *Tiptap 3.31* (`@tiptap/core`).
- Take ProseMirror objects (schema, state, transactions) from the editor, never from a copy of your own.
