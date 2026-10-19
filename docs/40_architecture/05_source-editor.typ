#import "/template.typ": unreviewed

= Source editor <architecture-source-editor>

#unreviewed

The plain Typst editor: #link("https://codemirror.net/")[CodeMirror] 6 bound to a `TypstDocument`, in `src/hosts/source-editor/`. It is a bare CodeMirror that keeps only text and selection in sync with its document; the basic setup, the look, highlighting, lint, links and other users' carets are contributions.

== SourceEditorHost <architecture-source-editor-host>

What `ExtensionContext.sourceEditor` is.

```ts
registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable
registerSharedCodeMirrorExtension(extension: Extension): Disposable
createSharedCodeMirrorExtension() → Extension    // for a CodeMirror made elsewhere: the shared ones, live
createEditor(parent, document, { onSelection? }) → SourceEditor    // the workbench calls it

subscriptions.push(
  sourceEditor.registerCodeMirrorExtension(lint(collection)),                     // all editors
  sourceEditor.registerCodeMirrorExtension((editor) => myLint(editor.document)),  // per editor
);
// your own CodeMirror, with the widget's look and the shared contributions:
new EditorView({ parent, doc, extensions: [basicSetup, sourceEditor.createSharedCodeMirrorExtension()] });
```

#table(
  columns: (auto, 1fr),
  table.header[Extension][Contribution],
  [`codeEditing`], [`basicSetup`, `indentWithTab`, `lineWrapping`. Shared: `codeColors`.],
  [`typstLanguage`], [Typst highlighting and indentation (`codemirror-lang-typst`, without its linter).],
  [`diagnostics`], [`lint`: the compiler's diagnostics underlined.],
  [`collaboration`], [Other users' carets and selections; `perUserUndo`.],
  [`invisibles`], [Shared: `highlightWhitespace()` while invisible characters are shown.],
  [workbench], [Document links of every provider for `typst` (@architecture-source-editor-links).],
)

- *Live:* a contribution reaches every editor, open ones included (they reconfigure a `Compartment`); disposing removes it from all. No feature tracks editors.
- *Shared* contributions are for any text, never a language. They reach the Source editors, the raw boxes and the text files' editor. Raw boxes take Typst ones through `visualEditor.registerRawBoxCodeMirrorExtension`.
- *Precedence* is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *`codeColors`* (code-editing's, shared) is the only look of every CodeMirror in the widget: the default highlight style colored by the `--zwf-syn-*` tokens, light or dark following the color scheme around the editor. No editor restyles on top of it. Without code-editing: CodeMirror's default light look, no history, no keymap beyond CodeMirror's defaults.
- *Sync:* the editor's own edits become `TextChange[]` with the editor as `origin`; changes of another origin arrive annotated `fromDocument.of({ origin })` and are not written back.
- *Undo* is CodeMirror's history (code-editing's `basicSetup`), and changes from elsewhere enter it. A contribution keeps edits out: `perUserUndo` reads `fromDocument` and drops other users' edits. No `Y.UndoManager`.
- *Tab* indents, Shift+Tab outdents (code-editing's `indentWithTab`); Escape, then Tab leaves the editor.
- `SourceEditor` (`reveal`, `insert`, `selection`): see the d.ts.

== Document links <architecture-source-editor-links>

`languages.registerDocumentLinkProvider(selector, provider, { priority? })`, as VS Code's "Follow link": ⌘-click or Alt+Enter follows, hover shows the target, a plain click edits. Every editor shows them: Source editors, raw boxes, the text files' editor, the Visual editor (reference chips, link marks, a box's picture).

```ts
languages.registerDocumentLinkProvider({ language: 'typst' }, {
  provideDocumentLinks(document) {   // TextDocument: path, languageId, text
    return [...document.text.matchAll(/TODO/g)].map((m) => ({
      range: SourceRange.of({ from: m.index, to: m.index + 4 }),
      tooltip: 'Open the to-do list',
      target: ProjectPath.of('/todo.typ'),
    }));
  },
});
```

- *`TextDocument.text`* is a whole file or a raw box's code; `languageId` is `typst` or the text file's (`csv`, `bibtex`, `mermaid`, …). A selector without `language` matches every text.
- *`DocumentLink`:* `target?` is a `ProjectPath` or an `https:`/`mailto:` `URL`; `command?` is offered in the hover (e.g. create a missing file); `selection?`, `tooltip?`.
- *Overlap:* the higher `priority` (default 100) wins, also for a box's primary link (its first in text order). Diagrams' "Edit diagram" (110) thus replaces the plain file link.
- *Cheap:* keep `provideDocumentLinks` fast; `resolveDocumentLink(link)` fills in the rest when a link is shown or followed.
- *Your own CodeMirror* shows them with `languages.createDocumentLinksCodeMirrorExtension(languageId, () => path)`.
