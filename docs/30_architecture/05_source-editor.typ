= Source editor <architecture-source-editor>

The plain Typst editor: CodeMirror 6 bound to a `TypstDocument`. Module `src/hosts/source-editor/`: the entry, and `code-colors.ts` for `codeColors`.

== SourceEditorHost <architecture-source-editor-host>

What `ExtensionContext.sourceEditor` is. Two contribution points, for the Source editors and for every CodeMirror of the widget:

```ts
registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable
registerSharedCodeMirrorExtension(extension: Extension): Disposable
createSharedCodeMirrorExtension() → Extension    // for a CodeMirror made elsewhere: the shared ones, live
createEditor(parent, document, { onSelection? }) → SourceEditor    // the workbench calls it
```

- A contribution applies to every editor: those made later and those already open. Open editors reconfigure a `Compartment`, so state the new configuration keeps survives.
- A function is called once per editor with its `SourceEditorContext` (`document`).
- Disposing the registration removes it from all editors.
- Precedence is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *Shared* contributions are for any text, never a language (shown whitespace): the Source editors take them with their own; the raw boxes (the workbench registers `createSharedCodeMirrorExtension()` as a raw-box extension) and the text files' editor include `createSharedCodeMirrorExtension()`, a `Compartment` reconfigured whenever the shared ones change, until that CodeMirror is destroyed. The Source editor host owns them as it owns `codeColors`, the other thing every CodeMirror of the widget shares.

== SourceEditor <architecture-source-editor-class>

```ts
.reveal(range: SourceRange)    // select, scroll to the center, highlight until an edit or the selection moves
.selection() → SourceRange
.dispose()
```

- *Mechanism kept:* `basicSetup`, `codeColors`, line wrapping, the reveal highlight, selection reporting.

== codeColors <architecture-source-editor-code-colors>

`codeColors` (a CodeMirror `Extension`, exported by the entry) is CodeMirror's default look in the widget, for every CodeMirror in it: the Source editors, the raw boxes' code (the Visual editor host) and the text files' editor (`textFiles`).

- CodeMirror's default highlight style, its colors from the `--te-syn-*` tokens of `typst-editor.css` (light: CodeMirror's own).
- CodeMirror's light or dark theme (cursor, selection, gutters, panels, tooltips), following the color of the text around the editor: the page's color-scheme, the widget's `workbench.theme`, the OS. Checked when the editor is placed or resized, when the OS scheme changes and when the widget's `data-scheme` changes.
- No editor restyles CodeMirror on top of it.
- *To the document:* an editor's own edits become `TextChange[]` with the editor as `origin`.
- *From the document:* changes with another origin are dispatched with the annotation `fromDocument.of({ origin })` and are not written back.

== Undo <architecture-source-editor-undo>

- Changes from elsewhere (the same user's Visual edits) enter the editor's history.
- A contribution decides what stays out: collaboration's `perUserUndo` reads `fromDocument` and keeps other users' edits out of the history.
- No `Y.UndoManager`: Undo reverts the last edit of this editor's history, never a collaborator's.

== What extensions contribute <architecture-source-editor-contributions>

#table(
  columns: (auto, 1fr),
  table.header[Extension][Contribution],
  [`typstLanguage`], [Typst syntax highlighting and indentation (`codemirror-lang-typst`, without its linter).],
  [`diagnostics`], [`lint`: the compiler's diagnostics underlined.],
  [`collaboration`], [Other users' carets and selections; `perUserUndo`.],
  [`invisibles`], [Shared: `highlightWhitespace()` while invisible characters are shown.],
  [workbench], [Document links of every provider for `typst` (@architecture-workbench).],
)

Writing one: @extensions-source-editor-and-preview.
