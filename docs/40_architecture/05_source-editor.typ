#import "/template.typ": unreviewed

= Source editor <architecture-source-editor>

#unreviewed

The plain Typst editor: #link("https://codemirror.net/")[CodeMirror] 6 bound to a `TypstDocument`, in `src/hosts/source-editor/`. It is a bare CodeMirror that keeps only text and selection in sync with its document; the basic setup, the look, highlighting, lint, links and other users' carets are contributions. The host is also the CodeMirror host: its contributions reach every CodeMirror of the widget, each picked by a selector.

== SourceEditorHost <architecture-source-editor-host>

What `ExtensionContext.sourceEditor` is.

```ts
registerCodeMirrorExtension(selector: CodeMirrorSelector, extension: Extension | ((editor: CodeMirrorContext) => Extension)): Disposable
codeMirrorExtensionsFor(editor: CodeMirrorContext): Extension    // for a CodeMirror made elsewhere: its contributions, live
createEditor(parent, document, { onSelection?, path? }) → SourceEditor    // the window calls it

subscriptions.push(
  sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, lint(collection)),              // all Source editors
  sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, (e) => (e.editor === 'source' ? myLint(e.document) : [])), // per editor
  sourceEditor.registerCodeMirrorExtension({ language: 'typst' }, typstSyntax()),                // all Typst
  sourceEditor.registerCodeMirrorExtension({}, highlightWhitespace()),                           // every CodeMirror
);
// your own CodeMirror, with the widget's look and what is registered for it:
new EditorView({ parent, doc, extensions: [basicSetup, sourceEditor.codeMirrorExtensionsFor({ editor: 'other', languageId: 'csv', path: () => file })] });
```

The CodeMirrors are of three kinds (`editor`):

#table(
  columns: (auto, 1fr, auto),
  table.header[`editor`][CodeMirror][`CodeMirrorContext`],
  [`source`], [a Source editor], [`languageId` `typst`, `path()`, `document`],
  [`rawBox`], [the code of a raw box of the Visual editor (the widget takes it from this host)], [`languageId` `typst`, `path()`, `document` (the Visual editor's)],
  [`other`], [an extension's own (`codeMirrorExtensionsFor`), e.g. the text files' editor], [`languageId`, `path()`],
)

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

- *Live:* a contribution reaches every editor, open ones included (they reconfigure a `Compartment`); disposing removes it from all. No feature tracks editors.
- *Selectors* are as the languages' (`DocumentFilter`): `language` and `editor`, each left out matches every CodeMirror; `{}` is every CodeMirror. One language's own goes by `language`, never to every CodeMirror. Made per editor, a contribution gets its `CodeMirrorContext`, a plain union: one that needs `document` narrows it itself (`if (editor.editor !== 'source') return [];`).
- *Precedence* is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *`codeColors`* (code-editing's, `{}`) is the only look of every CodeMirror in the widget: the default highlight style colored by the `--zwf-syn-*` tokens, light or dark following the color scheme around the editor. No editor restyles on top of it. Without code-editing: CodeMirror's default light look, no history, no keymap beyond CodeMirror's defaults.
- *Sync:* the editor's own edits become `TextChange[]` with the editor as `origin`; changes of another origin arrive annotated `fromDocument.of({ origin })` and are not written back.
- *Undo* is CodeMirror's history (code-editing's `basicSetup`), and changes from elsewhere enter it. A contribution keeps edits out: `perUserUndo` reads `fromDocument` and drops other users' edits. No `Y.UndoManager`.
- *Tab* indents, Shift+Tab outdents (code-editing's `indentWithTab`); Escape, then Tab leaves the editor.
- `SourceEditor` (`reveal`, `insert`, `selection`): see the d.ts.

== Document links <architecture-source-editor-links>

`languages.registerDocumentLinkProvider(selector, provider, { priority? })`, as VS Code's "Follow link": ⌘-click or Alt+Enter follows, hover shows the target, a plain click edits. The `documentLinks` extension shows them in every editor: Source editors, raw boxes, the text files' editor (a CodeMirror extension for `{}`), the Visual editor (reference chips, link marks; a box's picture). Without it no editor shows links. The host only merges: `languages.provideDocumentLinks(document)` and `resolveDocumentLink(link)`, as VS Code's `vscode.executeLinkProvider`.

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
- *Your own CodeMirror* shows them once it takes its contributions: `sourceEditor.codeMirrorExtensionsFor({ editor: 'other', languageId, path })`.
