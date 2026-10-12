= Source editor <features-source-editor>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("source-editor")

The Source tab of a Typst file shows its text as written, in #link("https://codemirror.net/")[CodeMirror]: Typst highlighting, line numbers, search.

```typ
#set heading(numbering: "1.1")
= Results <results>
@tab:timings lists the medians.
```

- It edits the same text as the Visual editor (@features-visual-editor); cursor and undo history survive a tab switch.
- Errors and warnings are underlined, the message as tooltip.
- Paths, references and links lead to their target with Ctrl+click (⌘-click on Mac) or Alt+Enter (@features-multi-file-projects, @features-labels-and-references).
- Text files (`.csv`, `.bib`, `.mmd`, …) open in a plain text editor of the same kind (@features-files).

== Why

For what the Visual editor shows as a raw box, for set and show rules, and for anyone who prefers the code.

== How to configure

- The option `viewType: 'sourceEditor'` opens the main file in it (@reference-configuration-options).
- `invisibles.show`: CodeMirror's marks for spaces and tabs (@features-invisible-characters).
