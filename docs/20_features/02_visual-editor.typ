= Visual editor <features-visual-editor>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("visual-editor", width: 60%)

The Visual editor shows a Typst file as a word processor does: headings, paragraphs, lists, tables and figures as they read, the markup hidden. This source

```typ
= Method
We compiled every document *twice*: from scratch and after a _one-word_ edit.

- [x] Run the measurements
- [ ] Ask Grace to check the numbers
```

shows as a heading "Method", a paragraph with "twice" in bold and "one-word" in italics, and a task list with one box checked. Typing changes the Typst; the preview (@features-rendering-preview) follows.

- A Typst file opens with two tabs, Visual and Source (@features-source-editor). Both edit the same text; cursor and undo history survive a tab switch.
- Untouched source stays byte for byte: an edit changes only the text it touches.
- What the Visual editor does not model (math, function calls) shows as a raw box (@features-full-typst-support).
- Formatting, shortcuts and the Insert menu: @features-styling-and-shortcuts.

== Why

Writers who do not know Typst write as in any word processor; the file stays plain Typst that compiles, diffs and merges like code.

== How to configure

- The option `viewType` sets the editor the main file opens in: `'visualEditor'` (the default) or `'sourceEditor'` (@reference-configuration-options). Typst files keep opening in the tab picked last.
- What it edits is made of extensions; a host can leave one out (@reference-embedding-extensions).
