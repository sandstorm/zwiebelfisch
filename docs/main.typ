// The documentation as a book: `mise run docs:pdf`. The parts (`= …`) and their chapters (one include each, in
// reading order) are written out, so the editor's links follow them; site.typ reads its HTML pages from this file.
#import "template.typ": book

#set document(title: "Zwiebelfisch")
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
  #include "20_features/14_html-preview.typ"
  #include "20_features/15_history.typ"
  #include "20_features/16_guest-access.typ"
  #include "20_features/17_start-page.typ"
]

= Configuration
#[
  #set heading(offset: 1)
  #include "30_configuration/01_options.typ"
  #include "30_configuration/02_embedding.typ"
  #include "30_configuration/03_collaboration-server.typ"
  #include "30_configuration/04_gitlab-integration.typ"
  #include "30_configuration/05_deployment.typ"
]

= Architecture
#[
  #set heading(offset: 1)
  #include "40_architecture/01_overview.typ"
  #include "40_architecture/02_data-model.typ"
  #include "40_architecture/03_extensions.typ"
  #include "40_architecture/04_conventions.typ"
  #include "40_architecture/05_development.typ"
]
