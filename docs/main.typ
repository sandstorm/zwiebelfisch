// The documentation as a book: `mise run docs:pdf`. site.typ builds the HTML pages from `parts`.
#import "template.typ": book

/// The chapters in reading order, by part: file → title (the HTML page title; the heading lives in the file).
#let parts = (
  (title: "Guide", chapters: (
    "guide/getting-started.typ": "Getting started",
    "guide/features.typ": "Features",
    "guide/configuration.typ": "Configuration",
    "guide/collaboration.typ": "Collaboration",
    "guide/embedding.typ": "Embedding",
  )),
  (title: "Extensions", chapters: (
    "extensions/overview.typ": "Extensions overview",
    "extensions/workbench-api.typ": "Workbench API",
    "extensions/visual-view-constructs.typ": "Visual view constructs",
    "extensions/source-view-and-preview.typ": "Source view and preview",
  )),
  (title: "Architecture", chapters: (
    "architecture/overview.typ": "Architecture overview",
    "architecture/core.typ": "Core",
    "architecture/prosemirror-typst.typ": "Typst ↔ ProseMirror",
    "architecture/visual-view.typ": "Visual view",
    "architecture/source-view.typ": "Source view",
    "architecture/preview.typ": "Preview",
    "architecture/workbench.typ": "Workbench",
    "architecture/built-in-extensions.typ": "Built-in extensions",
    "architecture/server.typ": "Server",
    "architecture/conventions.typ": "Conventions",
    "architecture/development.typ": "Development",
  )),
)

#set document(title: "Typst editor")
#show: book

#title()
#outline(depth: 3)

#for part in parts {
  heading(part.title)
  // a chapter's `=` heading sits below its part
  set heading(offset: 1)
  for path in part.chapters.keys() { include path }
}
