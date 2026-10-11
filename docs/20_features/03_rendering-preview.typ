= Rendering preview <features-rendering-preview>
#set heading(outlined: false)

== What it does

The preview on the right shows the pages as Typst compiles them, the whole document from the main file on, and updates while you type.

- On errors it dims and keeps the last good pages. Errors and warnings are underlined in both editors, the message as tooltip; the status bar counts them and jumps to them.
- Hidden, it keeps compiling: errors, raw boxes' pictures and shading stay current.
- Zoom (fit width by default, 25–400 %) and "page n / total" are in its toolbar.
- The preview is the right side's panel: its button on the right rail hides the right side (the editing area takes its room) and shows it again; where a host adds others (the devtools), the rail switches between them. Drag the separator (or use the arrow keys on it): the right side gets 20–80 % of the width. What you picked is remembered for the browser session.
- Following the cursor, shading the selection and clicking into the preview: @features-bidirectional-navigation. Downloading the PDF: @features-pdf.

== How to configure

*View menu:* "View ▾" at the top right of the editing area (the end of the tab bar) gathers how things are shown, a check mark at what is on, your choices remembered in this browser. After a separator below "Invisible characters" (@features-invisible-characters) come the preview's view options, for the preview only, never the PDF:

- "Comments" (on by default): the margin notes. Off, the preview draws the document as if it had none (a range note's text stays); the Visual editor keeps its notes, and the PDF has its own choice (@features-comments).
- "Page guides": dashed blue borders of the text area, the header and the footer (and column gutters), as LaTeX's `showframe`, for any page size and margins the document sets (`auto` ones too). A page background of the document's own stays; the guides are then drawn over the text.
- "Box outlines": a thin magenta outline around every block and box (headings, figures, lists, equations, `#block`, `#box`), around the inset and widened by the outset. A stroke the document gives stays as it is. Each `v(…)` (`1fr` too) is shaded as a teal hatched band where Typst laid it out; weak spacing that merged with the spacing between blocks shows nothing. The inset and the spacing between blocks are not drawn on their own.
- The pictures of raw boxes in the Visual editor are cut from the preview, so they show guides and outlines too.
- What other extensions offer for the preview is listed there, too.

Settings (@reference-configuration-settings):

- `workbench.rightSidePanel`: the panel the right side starts with (`'preview'`), or `null` to start with it hidden.
- `workbench.theme`: in dark mode the preview shows the pages inverted; the PDF stays as it is.
- `previewSync.followCursor`, `previewSync.highlightSelection`: @features-bidirectional-navigation.
