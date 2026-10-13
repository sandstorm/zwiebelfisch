= WYSIWYG editing <features-wysiwyg-editing>
#set heading(outlined: false)

#import "../template.typ": screenshot

The Visual editor shows a Typst file as a word processor does: headings, paragraphs, lists, tables and figures as they read, the markup hidden as much as possible.

#screenshot("styling-and-shortcuts")

== Rendering preview

The preview on the right shows the final compiled PDF, and updates while you type.

== Source editor

The Source tab of a Typst file shows its text as written, in #link("https://codemirror.net/")[CodeMirror].

#screenshot("source-editor")

- It edits the same text as the Visual editor; cursor and undo history survive a tab switch.
- Errors and warnings are underlined.

== Styling and shortcuts

The Visual editor's formatting works as in a word processor (built via #link("https://tiptap.dev/")[Tiptap] on #link("https://prosemirror.net/")[ProseMirror]).

*Keyboard shortcuts* like ⌘B, ⌘I, ⌘U work as expected. ⌘X with nothing selected cuts the whole paragraph, as IntelliJ cuts the line.

The "markdown shortcuts" you know, like typing `- ` or `- [ ]` work as expected.

Code blocks work with \`\`\`, as you know from Markdown.

*Moving blocks:* hovering a block (a paragraph, a heading, a list item, a table, a figure, a styled block, …) shows a grip (six dots) in the left margin, as in Notion or Slite. Drag it to move the block, its Typst unchanged; click it to select the block.

*Before and after a block:* the arrow keys stop between a block style, figure, table or code box and what follows (a blinking line across the text), so you can write right after it; a click into the space between blocks does the same. Backspace there selects the block before.

== Copy and paste

Copying copies the Typst source. A paste reads what the clipboard holds:

- *Typst*, from here, a text editor, a Typst code block on GitHub or in the Typst docs: as Typst.
- *Code in another language*, from VS Code or a highlighted block on a web page: a code block of that language (```` ```python ````).
- *Markdown*, from a chat's "Copy" button or a `.md` file: converted (`## Setup` → `== Setup`, `**bold**` → `*bold*`, lists, links, code, tables).
- *Web pages and word processors* (Word, Google Docs, LibreOffice): headings, bold, italic, links and lists as Typst. Word's bullet paragraphs become lists, text in a monospace font becomes code, empty lines are dropped.
- ⌘⇧V pastes plain text: `#`, `*`, `$` and the like escaped.

When the paste could go in another way, a *Paste as* chip ("Typst ▾") sits above its end: click it or press ⌘. to pick Typst, Markdown, Code block, HTML or Text. One ⌘Z undoes the paste. The chip goes away when you type on.

In the Source editor a paste goes in as it is; the same chip offers the conversions (Markdown → Typst, Code block, Text).

== Slash commands

#screenshot("slash-commands")

Type `/` in the Visual editor is a *quick-insert* control.

- *Examples*: `/spreadsheet` also finds "Insert table", `/123` finds "Numbered list", `/equation` finds "Inline math" and "Display math".

- *Context Sensitive*: Only what can apply at the cursor is listed.

Related Feature: Typing `@` is used to reference existing *labels* like figures or sections.

== Search everywhere

#screenshot("search-everywhere")

*Press Shift twice*, or click the magnifier on the left rail.

#table(
  columns: 3,
  [Group], [Prefix], [Picking],
  [Files], [`/`], [opens the file (the query may name folders: `/chap/intro`)],
  [Headings], [`#`], [jumps to the heading],
  [Labels], [`@`], [jumps to the label],
  [Figures], [`@`], [jumps to the figure, table or listing, found by caption or label],
  [Commands], [`>`], [runs it: Add comment, New file…, Number headings on / off, …],
  [Styles], [`*`], [applies the custom style to the selection],
  [Comments], [`!`], [opens the note, found by its text or an author],
  [Settings], [`:`], [switches it on / off, or asks for the value],
  [Text], [`%`], [lines of every Typst and text file holding the text; jumps there, the text selected],
)
