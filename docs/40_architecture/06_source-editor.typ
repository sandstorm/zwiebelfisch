#import "../template.typ": unreviewed

= Source editor <architecture-source-editor>

#unreviewed

The plain Typst editor: #link("https://codemirror.net/")[CodeMirror] 6 bound to a `TypstDocument`, in `src/hosts/source-editor/`. It is a bare CodeMirror; the basic setup, the look, highlighting, lint, links and other users' carets are contributions. `DocumentEditors` (`src/editor/widget/`) makes one per document as the custom editor `sourceEditor` of `*.typ` (`SourceEditorHost.createEditor`).

== SourceEditorHost <architecture-source-editor-host>

A contribution (`registerCodeMirrorExtension`) reaches every CodeMirror its selector (`language`, `editor`; empty: all) selects, open or made later: Source editors (`editor: 'source'`), raw boxes' code (`editor: 'rawBox'`) and your own CodeMirror (`codeMirrorExtensionsFor`).

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
- *Your own CodeMirror* (e.g. the text files' editor) takes the widget's look and what is registered for it through `codeMirrorExtensionsFor({ editor: 'other', languageId, path })`.
- *Selectors:* one language's own goes by `language`, never to every CodeMirror; one that needs the document is a function, asked per CodeMirror with its `CodeMirrorContext`, which narrows it itself (`if (editor.editor !== 'source') return [];`).
- *Precedence* is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *`codeColors`* (code-editing's, `{}`) is the only look of every CodeMirror in the widget: the default highlight style colored by the `--zwf-syn-*` tokens, light or dark following the color scheme around the editor. No editor restyles on top of it.
- *Undo* is CodeMirror's history (code-editing's `basicSetup`); changes from elsewhere enter it. No `Y.UndoManager`.
- *Tab* indents, Shift+Tab outdents (code-editing's `indentWithTab`); Escape, then Tab leaves the editor.
- *Sync:* changes from elsewhere arrive marked `fromDocument` with their origin and are never sent back; `perUserUndo` (collaboration's) keeps other users' edits out of the undo history.

== Document links <architecture-source-editor-links>

As VS Code's "Follow link": ⌘-click or Alt+Enter follows, hover shows the target, a plain click edits.

`languages` only merges the providers' links; the `documentLinks` extension shows them in Source editors, text files, raw boxes and the Visual editor's text (chips, link marks). Without it no editor shows a link.

- *Cheap first:* `provideDocumentLinks` gives cheap links; the optional `resolveDocumentLink` fills in target, tooltip or command when a link is shown or followed (VS Code's `DocumentLinkProvider`).
- *`TextDocument.text`* is a whole file or a raw box's code; `languageId` is `typst` or the text file's (`csv`, `bibtex`, `mermaid`, …). A selector without `language` matches every text.
- *Overlap:* diagrams' "Edit diagram" (priority 110) replaces the plain file link, also as a box's primary link (its first in text order).

== How extensions hook in <architecture-source-editor-extensions>

A CodeMirror extension for the editors a selector picks, and a link provider for a language: both are plain contributions, gone on dispose.

```ts
// simplified from src/extensions/code-editing/code-editing.ts
activate({ sourceEditor, subscriptions }) {
  subscriptions.push(
    sourceEditor.registerCodeMirrorExtension({}, codeColors), // every CodeMirror's look
    sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, // Source editors only
      [basicSetup, keymap.of([indentWithTab]), EditorView.lineWrapping]),
  );
}

// simplified from src/extensions/markup/window/url-links.ts
const urlLinks: DocumentLinkProvider = {
  provideDocumentLinks(document) {
    const links: DocumentLink[] = [];
    const cursor = syntaxTree(document).cursor();
    do {
      // a bare URL or #link("…"): { range, target: URL }, else null
      const link = linkOf(cursor.node, document.text);
      if (link) links.push(link);
    } while (cursor.next());
    return links;
  },
};
// markup's activate:
//   languages.registerDocumentLinkProvider({ language: 'typst' }, urlLinks)
```

- *Without code-editing* a Source editor is a bare CodeMirror in CodeMirror's default light look: the text still in sync, no line numbers, history or keymap.
- *Without markup* a URL is plain text in every editor; other providers' links (labels, file paths) stay.
