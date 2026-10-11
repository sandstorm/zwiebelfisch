= Source editor <architecture-source-editor>

The plain Typst editor: CodeMirror 6 bound to a `TypstDocument`. Module `src/hosts/source-editor/`, one file.

== SourceEditorHost <architecture-source-editor-host>

What `ExtensionContext.sourceEditor` is. One contribution point:

```ts
registerCodeMirrorExtension(extension: Extension | ((view: SourceEditorContext) => Extension)): Disposable
createView(parent, document, { onSelection? }) → SourceEditor    // the workbench calls it
```

- A contribution applies to every view: those made later and those already open. Open views reconfigure a `Compartment`, so state the new configuration keeps survives.
- A function is called once per view with its `SourceEditorContext` (`document`).
- Disposing the registration removes it from all views.
- Precedence is CodeMirror's own (`Prec.highest` … `Prec.lowest`).

== SourceEditor <architecture-source-editor-view>

```ts
.reveal(range: SourceRange)    // select, scroll to the center, highlight until an edit or the selection moves
.selection() → SourceRange
.dispose()
```

- *Mechanism kept:* `basicSetup`, line wrapping, the reveal highlight, selection reporting.
- *To the document:* a view's own edits become `TextChange[]` with the view as `origin`.
- *From the document:* changes with another origin are dispatched with the annotation `fromDocument.of({ origin })` and are not written back.

== Undo <architecture-source-editor-undo>

- Changes from elsewhere (the same user's Visual edits) enter the view's history.
- A contribution decides what stays out: collaboration's `perUserUndo` reads `fromDocument` and keeps other users' edits out of the history.
- No `Y.UndoManager`: Undo reverts the last edit of this view's history, never a collaborator's.

== What extensions contribute <architecture-source-editor-contributions>

#table(
  columns: (auto, 1fr),
  table.header[Extension][Contribution],
  [`typstLanguage`], [Typst syntax highlighting and indentation (`codemirror-lang-typst`, without its linter), code colors.],
  [`diagnostics`], [`lint`: the compiler's diagnostics underlined.],
  [`collaboration`], [Other users' carets and selections; `perUserUndo`.],
  [workbench], [Document links of every provider for `typst` (@architecture-workbench).],
)

Writing one: @extensions-source-editor-and-preview.
