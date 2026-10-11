// The documentation as a book: `mise run docs:pdf`. The parts (`= …`) and their chapters (one include each, in
// reading order) are written out, so the editor's links follow them; site.typ reads its HTML pages from this file.
#import "template.typ": book

#set document(title: "Typst editor")
#show: book

#title()
#outline(depth: 3)

// a chapter's `=` heading sits below its part

= Guide
#[
  #set heading(offset: 1)
  #include "10_guide/01_getting-started.typ"
  #include "10_guide/02_features.typ"
  #include "10_guide/03_configuration.typ"
  #include "10_guide/04_collaboration.typ"
  #include "10_guide/05_embedding.typ"
]

= Extensions
#[
  #set heading(offset: 1)
  #include "20_extensions/01_overview.typ"
  #include "20_extensions/02_workbench-api.typ"
  #include "20_extensions/03_visual-view-constructs.typ"
  #include "20_extensions/04_source-view-and-preview.typ"
]

= Architecture
#[
  #set heading(offset: 1)
  #include "30_architecture/01_overview.typ"
  #include "30_architecture/02_core.typ"
  #include "30_architecture/03_prosemirror-typst.typ"
  #include "30_architecture/04_visual-view.typ"
  #include "30_architecture/05_source-view.typ"
  #include "30_architecture/06_preview.typ"
  #include "30_architecture/07_workbench.typ"
  #include "30_architecture/08_built-in-extensions.typ"
  #include "30_architecture/09_server.typ"
  #include "30_architecture/10_conventions.typ"
  #include "30_architecture/11_development.typ"
]
