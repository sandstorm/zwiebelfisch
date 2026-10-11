= Full Typst support <features-full-typst-support>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("full-typst-support")

Every Typst document opens and compiles, also what the Visual editor has no construct for: math, function calls, set and show rules, scripting, packages.

```typ
The energy is $E = m c^2$, and

$ sum_(k=1)^n k = (n(n+1)) / 2 $

#rect(fill: aqua)[A box of its own]
```

The Visual editor shows each such piece as a *raw box*: its compiled look, cut from the preview, while the cursor is elsewhere; its Typst code, highlighted, while the cursor is in it. The preview shows the document as Typst compiles it.

- Math: type it as in Typst. `$a^1$` becomes inline math when the closing `$` is typed (Backspace right after gives the text back); `$ x^2 $` (spaces inside both dollars) alone on an empty line becomes display math, a block. Or Insert → Inline math / Display math (`/math`), which puts the cursor into the new formula. `\$` or a dollar with a space on one side only (`$5 and $10`) stays a dollar sign.
- A box's code is edited in CodeMirror, as in the Source editor: Tab / Shift+Tab indent / outdent.
- A box's picture leads where its code links to (a file, a diagram): Ctrl+click (⌘-click on Mac), or Alt+Enter on the selected box (@features-multi-file-projects).
- Untouched source stays byte for byte; the Source editor (@features-source-editor) always shows all of it.
- `#import "@preview/name:version"` works as on typst.app: the package is downloaded from `packages.typst.org` on first use and kept by the browser.

== Why

A document never has to be reduced to what a word processor can show: templates, packages and scripting keep working, and writers still edit the text around them.

== How to configure

Nothing to configure. A host's Content-Security-Policy must allow `connect-src https://packages.typst.org` for packages (@reference-embedding-library).
