#import "../template.typ": api, unreviewed

= Source editor <architecture-source-editor>

#unreviewed

The plain Typst editor: #link("https://codemirror.net/")[CodeMirror] 6 bound to a `TypstDocument`, in `src/hosts/source-editor/`. It is a bare CodeMirror; the basic setup, the look, highlighting, lint, links and other users' carets are contributions.

== SourceEditorHost <architecture-source-editor-host>

#api("/src/hosts/source-editor/source-editor.ts", "SourceEditorContributions")
#api("/src/hosts/source-editor/source-editor.ts", "CodeMirrorSelector")
#api("/src/hosts/source-editor/source-editor.ts", "CodeMirrorContext")
#api("/src/hosts/source-editor/source-editor.ts", "CodeMirrorText")

```ts
subscriptions.push(
  sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, lint(collection)),              // all Source editors
  sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, (e) => (e.editor === 'source' ? myLint(e.document) : [])), // per editor
  sourceEditor.registerCodeMirrorExtension({ language: 'typst' }, typstSyntax()),                // all Typst
  sourceEditor.registerCodeMirrorExtension({}, highlightWhitespace()),                           // every CodeMirror
);
// your own CodeMirror, with the widget's look and what is registered for it:
new EditorView({ parent, doc, extensions: [basicSetup, sourceEditor.codeMirrorExtensionsFor({ editor: 'other', languageId: 'csv', path: () => file })] });
```

#table(
  columns: (auto, 1fr),
  table.header[Extension][Contribution],
  [`codeEditing`], [`{ editor: 'source' }`: `basicSetup`, `indentWithTab`, `lineWrapping`. `{}`: `codeColors`.],
  [`typstLanguage`], [`{ language: 'typst' }`: Typst highlighting and indentation (`codemirror-lang-typst`, without its linter).],
  [`diagnostics`], [`{ editor: 'source' }`: `lint`, the compiler's diagnostics underlined.],
  [`search`], [`{ editor: 'source' }`: every match highlighted.],
  [`clipboard`], [`{ editor: 'source' }`: paste through the paste edit providers.],
  [`collaboration`], [`{ editor: 'source' }`: other users' carets and selections, `perUserUndo`. `{ editor: 'rawBox' }`: their carets in a box's code.],
  [`invisibles`], [`{}`: `highlightWhitespace()` while invisible characters are shown.],
  [`documentLinks`], [`{}`: the document links of every provider for the text's language (@architecture-source-editor-links).],
)

- *Live:* open editors reconfigure a `Compartment`; no feature tracks editors.
- *Selectors:* one language's own goes by `language`, never to every CodeMirror; one that needs `document` narrows the context itself (`if (editor.editor !== 'source') return [];`).
- *Precedence* is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *`codeColors`* (code-editing's, `{}`) is the only look of every CodeMirror in the widget: the default highlight style colored by the `--zwf-syn-*` tokens, light or dark following the color scheme around the editor. No editor restyles on top of it. Without code-editing: CodeMirror's default light look, no history, no keymap beyond CodeMirror's defaults.
- *Sync:* the editor's own edits become `TextChange[]` with the editor as `origin`; the others arrive marked:
  #api("/src/hosts/source-editor/source-editor.ts", "fromDocument")
- *Undo* is CodeMirror's history (code-editing's `basicSetup`), and changes from elsewhere enter it. `perUserUndo` reads `fromDocument` and drops other users' edits. No `Y.UndoManager`.
- *Tab* indents, Shift+Tab outdents (code-editing's `indentWithTab`); Escape, then Tab leaves the editor.

== Document links <architecture-source-editor-links>

As VS Code's "Follow link": ⌘-click or Alt+Enter follows, hover shows the target, a plain click edits. The `documentLinks` extension shows them in every editor: Source editors, raw boxes, the text files' editor (a CodeMirror extension for `{}`), the Visual editor (reference chips, link marks; a box's picture). Without it no editor shows links. The host only merges.

#api("/src/hosts/languages/languages.ts", "Languages", docs: "first-sentence", only: ("registerDocumentLinkProvider", "provideDocumentLinks", "resolveDocumentLink"))
#api("/src/hosts/languages/languages.ts", "DocumentLinkProvider")
#api("/src/hosts/languages/languages.ts", "DocumentLink")

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
- *Overlap:* diagrams' "Edit diagram" (priority 110) replaces the plain file link, also as a box's primary link (its first in text order).
- *Your own CodeMirror* shows them once it takes its contributions (`codeMirrorExtensionsFor`).
