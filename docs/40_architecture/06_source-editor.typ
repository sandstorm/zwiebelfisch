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
  [`documentLinks`], [`{}`: the document links of every provider for the text's language.],
)
