= Full Typst support <features-full-typst-support>
#set heading(outlined: false)

== What it does

Every Typst document opens and compiles, also what the Visual editor has no construct for: math, function calls, set and show rules, scripting, packages. A report's measurements, a helper computing from them, a formula and a table built by a loop:

#import "../template.typ": example

#example[
  ```typ
  #let runs = (
    (pages: 1, cold: 41, incremental: 9),
    (pages: 10, cold: 180, incremental: 11),
    (pages: 100, cold: 1650, incremental: 14),
  )
  #let speedup(run) = calc.round(run.cold / run.incremental, digits: 1)

  The speed-up of an incremental compile for a document of $p$ pages is

  $ s(p) = (t_"cold" (p)) / (t_"incremental" (p)) $

  #table(
    columns: 4,
    align: (left, right, right, right),
    table.header[Pages][Cold (ms)][Incremental (ms)][Speed-up],
    ..for run in runs {
      (str(run.pages), str(run.cold), str(run.incremental), [#speedup(run) ×])
    },
  )

  For #runs.last().pages pages, an edit compiles #speedup(runs.last()) times faster.
  ```
]

The Visual editor shows each such piece as a *raw box*: here the `#let` lines, the formula and the table. A box shows its compiled look, cut from the preview, while the cursor is elsewhere; its Typst code, highlighted, while the cursor is in it. The two sentences around them stay text to edit. The preview shows the document as Typst compiles it.

- Math: type it as in Typst. `$a^1$` becomes inline math when the closing `$` is typed (Backspace right after gives the text back); `$ x^2 $` (spaces inside both dollars) alone on an empty line becomes display math, a block. Or Insert → Inline math / Display math (`/math`), which puts the cursor into the new formula. `\$` or a dollar with a space on one side only (`$5 and $10`) stays a dollar sign.
- A box's code is edited in CodeMirror, as in the Source editor: Tab / Shift+Tab indent / outdent.
- A box's picture leads where its code links to (a file, a diagram): Ctrl+click (⌘-click on Mac), or Alt+Enter on the selected box (@features-multi-file-projects).
- Untouched source stays byte for byte; the Source editor (@features-source-editor) always shows all of it.
- `#import "@preview/name:version"` works as on typst.app: the package is downloaded from `packages.typst.org` on first use and kept by the browser.

== Why

A document never has to be reduced to what a word processor can show: templates, packages and scripting keep working, and writers still edit the text around them.

== How to configure

Nothing to configure. A host's Content-Security-Policy must allow `connect-src https://packages.typst.org` for packages (@reference-embedding-library).
