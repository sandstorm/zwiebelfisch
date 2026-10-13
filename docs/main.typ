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
  #include "20_features/01_wysiwyg-editing.typ"
  #include "20_features/02_bidirectional-navigation.typ"
  #include "20_features/03_writing.typ"
  #include "20_features/04_full-typst-support.typ"
  #include "20_features/05_multiple-files.typ"
  #include "20_features/06_custom-styles.typ"
  #include "20_features/07_drawio-diagrams.typ"
  #include "20_features/08_spreadsheets.typ"
  #include "20_features/09_mermaid-diagrams.typ"
  #include "20_features/10_comments.typ"
  #include "20_features/11_find-in-files.typ"
  #include "20_features/12_collaborative-editing.typ"
  #include "20_features/13_gitlab.typ"
]

= Configuration
#[
  #set heading(offset: 1)
  #include "30_configuration/01_options.typ"
  #include "30_configuration/02_embedding.typ"
  #include "30_configuration/03_collaboration-server.typ"
  #include "30_configuration/04_gitlab-integration.typ"
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
  #include "40_architecture/11_visual-editor-constructs.typ"
  #include "40_architecture/12_source-editor-and-preview.typ"
  #include "40_architecture/13_server.typ"
  #include "40_architecture/14_conventions.typ"
  #include "40_architecture/15_development.typ"
]
