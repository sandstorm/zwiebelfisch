= Features overview <features-overview>

This project is both an *authoring environment* and *embeddable WYSIWYG Editor* for typst files at once.

Each feature has a chapter of its own: what it does, why one needs it, how to configure it.

== Basic Features <features-overview-basic>

- *Visual editor:* edits Typst projects like a word processor, including styling, headlines, lists, \... (@features-visual-editor)

- Typographic *rendering preview*, displaying the full source document. (@features-rendering-preview)

- for nerds, a *Source Editor* where you can write the Typst file directly is also included :-) (@features-source-editor)

- *Standard word processor styling and shortcuts* supported (via https://tiptap.dev/ and #link("https://prosemirror.net/")[https:\//prosemirror.net/]) (@features-styling-and-shortcuts)

- Support for *code blocks with syntax highlighting*, via ```` ``` ```` for multiline code and ``` ` ``` for inline code (@features-code-blocks)

- Support for *images* (@features-images)
- Support for *tables* (@features-tables)
- *Headings and table of contents* (@features-table-of-contents)
- *Labels and cross-references* to headings, figures and tables (@features-labels-and-references)
- *Page layout:* page breaks and rules (@features-page-layout)
- *Full Typst support:* If an element is not supported natively, f.e. maths like $E=m*c^2$, we always fall back to the raw Typst source. (@features-full-typst-support)
- *Files:* a file panel for every file of the project (@features-files)
- *Spelling*, checked in the document's language (@features-spelling)
- *PDF* download (@features-pdf)

== User experience <features-overview-ux>

- *Slash commands:* type `/` in the Visual editor for everything the Insert and text style menus offer (@features-slash-commands)
- *Search everywhere:* files, headings, labels, commands, text; press Shift twice (@features-search-everywhere)
- *Bidirectional navigation*: click any part of the preview to jump to the corresponding source, and select any part of the interactive editor to highlight this in the preview. (@features-bidirectional-navigation)
- *Help:* a cheat sheet for the file you edit (@features-help)
- *Invisible characters*, as a word processor's formatting marks (@features-invisible-characters)

== Advanced Features <features-overview-advanced>

- Support for *Custom Styles*, so you can easily create inline styles and *Block Styles* for things like custom call-outs. (@features-custom-styles)

- Support for *draw.io diagrams*, which can be directly edited inline and embedded. (@features-drawio-diagrams)

- Support for *Spreadsheets* (based on #link("https://www.ironcalc.com/")[IronCalc]), which can be edited inline, including calculations, and then embedded (fully or partially) into the Typst file (@features-spreadsheets)
  - spreadsheet styling is transferred to Typst
- Support for *mermaid diagrams* if you prefer text-based diagrams. (@features-mermaid-diagrams)
- Support for *multi-file* projects. (@features-multi-file-projects)
- *Comments* as margin notes in the Typst source (@features-comments)
- Support for *collaborative real-time editing*. (@features-collaborative-editing)
- *GitLab* integration: Edit any Typst project from Gitlab, and write back changes. (@features-gitlab)
