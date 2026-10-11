= Styling and shortcuts <features-styling-and-shortcuts>
#set heading(outlined: false)

== What it does

The Visual editor's formatting works as in a word processor (#link("https://tiptap.dev/")[Tiptap] on #link("https://prosemirror.net/")[ProseMirror]): the usual shortcuts, a bar over a selection, an Insert menu and a text style menu. Each writes Typst:

```typ
We compiled every document *twice*: from scratch and after a _one-word_ edit,
with the #link("https://typst.app")[Typst] compiler.

+ Generate documents of 1 to 100 pages.
+ Compile each one cold, then incrementally.
```

In the Visual editor "twice" is bold, "one-word" italic, "Typst" a link, then a numbered list; the preview shows the same as Typst sets it.

#table(
  columns: 2,
  [Construct], [How],
  [Bold, italic, underline, strikethrough, highlight, inline code], [Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+S, Ctrl+Shift+H, Ctrl+E (⌘B, ⌘I, ⌘U, ⌘⇧S, ⌘⇧H, ⌘E on Mac; the two with Shift are Tiptap's own), or the bar over a selection. Or type them as in Typst: `*bold*`, `_italic_`, code between backticks. Underline, strikethrough and highlight are `#underline[..]`, `#strike[..]` and `#highlight[..]`; one with arguments (`stroke:`, `offset:`, `fill:`) stays a raw box.],
  [Link], [Ctrl+K (⌘K on Mac), or "Link" in the bar over a selection. Ctrl+click (⌘-click on Mac) on a link, or Alt+Enter in it, opens its address in a new tab; a plain click edits it.],
  [Lists], [List buttons: bulleted, numbered, task list (`- [ ] todo`). Or type at a line start, as in Typst: `- ` bulleted, `+ ` numbered (also `1. `). Tab nests.],
  [Quote], [Ctrl+Shift+B (⌘⇧B on Mac), Insert → Quote, or `> ` at a line start (Typst has no quote markup: it writes `#quote(block: true)[..]`).],
  [Alignment], [Align menu, or Ctrl+Shift+L / E / R / J (⌘⇧L / E / R / J on Mac): `#align(center)[..]`, `#par(justify: true)[..]`.],
  [Undo, redo], [Ctrl+Z, Ctrl+Shift+Z (⌘Z, ⌘⇧Z on Mac).],
  [Copy and paste], [What you copy is its Typst source; pasted text is read as Typst (a figure pasted from a `.typ` file stays a figure). The imports it needs come along (`#import "@preview/merman:0.4.0": mermaid` at the top), in either view. Pasted labels keep their references (@features-labels-and-references). Ctrl+Shift+V (⌘⇧V on Mac) pastes the characters as they are.],
  [Tab, Shift+Tab], [Stay in the text: nest or un-nest a list item, go to the next or previous table cell (Tab in the last one adds a row), indent or outdent a code block's line or a raw box's code. Elsewhere they do nothing. To move the focus on with the keyboard: Escape, then Tab (or Shift+Tab).],
  [Anything from the Insert or text style menu], [Type `/` at a line start or after a space, then part of its name: `/table`, `/h2`, `/quote` (@features-slash-commands).],
)

Headings: @features-table-of-contents. Code blocks: @features-code-blocks. Math: @features-full-typst-support. Styles of the document's own: @features-custom-styles.

== How to configure

Nothing to configure.
