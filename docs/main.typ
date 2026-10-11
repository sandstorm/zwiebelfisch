// The documentation as a book: `mise run docs:pdf`. The parts (`= …`) and their chapters (one include each, in
// reading order) are written out, so the editor's links follow them; site.typ reads its HTML pages from this file.
#import "template.typ": book

#set document(title: "Typst editor")
#show: book

#title()
#outline(depth: 3)

// a chapter's `=` heading sits below its part

// a part of its own: its `=` heading is the part's, its sections stay on the part's pages
#include "10_getting-started/01_getting-started.typ"

= Features
#[
  #set heading(offset: 1)
  #include "20_features/01_overview.typ"
  #include "20_features/02_visual-editor.typ"
  #include "20_features/03_rendering-preview.typ"
  #include "20_features/04_source-editor.typ"
  #include "20_features/05_styling-and-shortcuts.typ"
  #include "20_features/06_code-blocks.typ"
  #include "20_features/07_images.typ"
  #include "20_features/08_tables.typ"
  #include "20_features/09_table-of-contents.typ"
  #include "20_features/10_labels-and-references.typ"
  #include "20_features/11_page-layout.typ"
  #include "20_features/12_full-typst-support.typ"
  #include "20_features/13_bidirectional-navigation.typ"
  #include "20_features/14_files.typ"
  #include "20_features/15_search-everywhere.typ"
  #include "20_features/16_help.typ"
  #include "20_features/17_invisible-characters.typ"
  #include "20_features/18_spelling.typ"
  #include "20_features/19_pdf.typ"
  #include "20_features/20_custom-styles.typ"
  #include "20_features/21_drawio-diagrams.typ"
  #include "20_features/22_spreadsheets.typ"
  #include "20_features/23_mermaid-diagrams.typ"
  #include "20_features/24_multi-file-projects.typ"
  #include "20_features/25_comments.typ"
  #include "20_features/26_collaborative-editing.typ"
  #include "20_features/27_gitlab.typ"
]

= Reference
#[
  #set heading(offset: 1)
  #include "30_reference/01_configuration.typ"
  #include "30_reference/02_embedding.typ"
  #include "30_reference/03_collaboration-server.typ"
]

= Architecture
#[
  #set heading(offset: 1)
  #include "40_architecture/01_overview.typ"
  #include "40_architecture/02_core.typ"
  #include "40_architecture/03_prosemirror-typst.typ"
  #include "40_architecture/04_visual-editor.typ"
  #include "40_architecture/05_source-editor.typ"
  #include "40_architecture/06_preview.typ"
  #include "40_architecture/07_workbench.typ"
  #include "40_architecture/08_built-in-extensions.typ"
  #include "40_architecture/09_extensions-overview.typ"
  #include "40_architecture/10_workbench-api.typ"
  #include "40_architecture/11_visual-editor-constructs.typ"
  #include "40_architecture/12_source-editor-and-preview.typ"
  #include "40_architecture/13_server.typ"
  #include "40_architecture/14_conventions.typ"
  #include "40_architecture/15_development.typ"
]
