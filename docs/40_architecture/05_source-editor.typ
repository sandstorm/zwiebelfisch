= Source editor <architecture-source-editor>

The plain Typst editor: #link("https://codemirror.net/")[CodeMirror] 6 bound to a `TypstDocument`. Module `src/hosts/source-editor/`.

== SourceEditorHost <architecture-source-editor-host>

What `ExtensionContext.sourceEditor` is. It has two contribution points: one for the Source editors, one for every CodeMirror of the widget.

```ts
registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable
registerSharedCodeMirrorExtension(extension: Extension): Disposable
createSharedCodeMirrorExtension() → Extension    // for a CodeMirror made elsewhere: the shared ones, live
createEditor(parent, document, { onSelection? }) → SourceEditor    // the workbench calls it
```

A contribution, e.g. the diagnostics extension's:

```ts
subscriptions.push(sourceEditor.registerCodeMirrorExtension(lint(collection)));
```

- *Live:* a contribution applies to every editor, also those already open (they reconfigure a `Compartment`). Disposing removes it from all.
- *Per editor:* a function is called once per editor with its `SourceEditorContext` (`document`).
- *Precedence* is CodeMirror's own (`Prec.highest` … `Prec.lowest`).
- *Shared* contributions are for any text, never a language (shown whitespace). The raw boxes and the text files' editor take them through `createSharedCodeMirrorExtension()`.

== SourceEditor <architecture-source-editor-class>

```ts
.reveal(range: SourceRange)    // focus, select, scroll to the center, highlight until an edit or the selection moves
.insert(text: string)          // replace the selection, focus
.selection() → SourceRange
.dispose()
```

- *Mechanism kept:* `basicSetup`, `codeColors`, line wrapping, the reveal highlight, selection reporting.
- *To the document:* the editor's own edits become `TextChange[]` with the editor as `origin`.
- *From the document:* changes with another origin are dispatched with the annotation `fromDocument.of({ origin })` and not written back.
- *Tab* indents the selected lines, Shift+Tab outdents them (`indentWithTab`); Escape, then Tab leaves. The text files' editor does the same.

== codeColors <architecture-source-editor-code-colors>

`codeColors` (a CodeMirror `Extension`, exported by the entry; its parts in `code-colors.ts`) is CodeMirror's look in the widget, for every CodeMirror in it: the Source editors, the raw boxes' code and the text files' editor.

- *Highlighting:* CodeMirror's default highlight style, its colors from the `--te-syn-*` tokens of `typst-editor.css`.
- *Theme:* CodeMirror's light or dark theme, following the color scheme around the editor (page, `workbench.theme`, OS).
- No editor restyles CodeMirror on top of it.

== Undo <architecture-source-editor-undo>

- Changes from elsewhere (the same user's Visual edits) enter the editor's history.
- A contribution decides what stays out: collaboration's `perUserUndo` reads `fromDocument` and keeps other users' edits out.
- No `Y.UndoManager`: Undo never reverts a collaborator's edit.

== What extensions contribute <architecture-source-editor-contributions>

#table(
  columns: (auto, 1fr),
  table.header[Extension][Contribution],
  [`typstLanguage`], [Typst syntax highlighting and indentation (`codemirror-lang-typst`, without its linter).],
  [`diagnostics`], [`lint`: the compiler's diagnostics underlined.],
  [`collaboration`], [Other users' carets and selections; `perUserUndo`.],
  [`invisibles`], [Shared: `highlightWhitespace()` while invisible characters are shown.],
  [workbench], [Document links of every provider for `typst` (@architecture-workbench): ⌘-click or Alt+Enter follows one, with the same hint as in every editor.],
)

Writing one: @architecture-source-editor-and-preview.
