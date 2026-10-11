= Multi-file projects <features-multi-file-projects>
#set heading(outlined: false)

== What it does

A book's main file pulls in its chapters; chapters read data, images and the bibliography from other files:

```typ
#include "chapters/method.typ"
#let runs = csv("data/runs.csv")
#bibliography("references.bib")
```

The preview always shows the whole document, compiled from the main file; the editors show one file at a time. The file panel holds them all (@features-files).

- Paths in `#import`, `#include`, `image`, `read`, `bibliography`, `json` / `csv` / `yaml` / `toml` / `xml` / `cbor` open their file: Ctrl+click or Alt+Enter (⌘-click or ⌥↩ on Mac) in the Source editor and in a raw box's code. In the Visual editor a box's picture follows its first link the same way (Alt+Enter on the selected box); hovering says where.
- Every link follows this rule: references and links to labels (@features-labels-and-references), web and mail addresses (bare URLs, `#link("https://…")`, opened in a new tab).
- A missing `.typ` file can be created from there.
- A file the main file includes gets "← previous file" / "next file →" links in reading order.
- Back and forward, as in VS Code: after any change of the shown file (a link, a click in the preview, the file panel, …), "← Back to _file_" above a supplementary file (a Mermaid diagram, a spreadsheet, a text file, …) returns to it, in the editor it was shown in, with its selection (Typst files). After going back, "Forward to _file_ →" returns. Typst files show the reading order instead; the keys work everywhere. Keys: Ctrl+Alt+- back, Ctrl+Shift+- forward (⌃- / ⌃⇧- on Mac). The last 50 files; renamed files keep their place, deleted ones drop out.
- A click in the preview opens the file the clicked text is in (@features-bidirectional-navigation).

== Why

Long documents are easier to write, review and merge chapter by chapter; data and pictures stay in files of their own.

== How to configure

The host gives the files and names the main file: options `files` and `main` (@reference-configuration-options, @reference-embedding-files).
