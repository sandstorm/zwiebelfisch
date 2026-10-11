#import "../template.typ": mermaid

= Comments <features-comments>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("comments")

Comments are #link("https://typst.app/universe/package/drafting/")[drafting] margin notes in the Typst source: they travel through saves, git, diffs and collaboration like any other text.

Select "grows linearly", press Ctrl+Alt+M (⌘⌥M on Mac), type the note; a co-author replies on the card. The file then holds:

```typ
#import "@preview/drafting:0.2.2": margin-note

Cold compile time #margin-note[grows linearly][- *Ada* (2026-10-10): Linear up to 100 pages only? Add the 500-page run.
- *Grace* (2026-10-11): Running it tonight.] with the page count.
```

What Grace sees in the Visual editor: "grows linearly" highlighted with a speech bubble after it; a click on the bubble opens the card, floating below it:

#figure(
  mermaid(read("../diagrams/comment-card.mmd"), width: 65%),
  caption: [A comment card.],
)

The preview shows the notes in the page margin, as small text in an amber box.

- Add: "Comment" (Visual editor toolbar or selection bar, Source editor tab bar) or Ctrl+Alt+M (⌘⌥M on Mac). Without a selection: a point note at the cursor.
- A note is a thread: one list item per message, signed with your name and the date.
- In the text: a note's speech bubble shows its first author and words on hover. The card opens with a click on the bubble or into the highlighted text, or with Alt+Enter (⌥↩ on Mac) at the note. Escape, Close or a click elsewhere closes it; the text gets the focus back. There is no column of cards beside the text: one card at a time floats at its note.
- On the card: reply (Ctrl+Enter sends, ⌘↩ on Mac), edit your own and unsigned messages, delete your last one, Resolve (deletes the note). A new note's card opens with the focus in its reply box; closing it sends what was typed there. A co-author's reply shows on an open card at once.
- Search everywhere finds notes by text or author: `!` (@features-search-everywhere).
- The editor gives the notes their look in the preview and in a PDF with comments; the file holds only the import and the notes. A document's own `#set-margin-note-defaults(…)` wins over it.
- A page margin given as one length (`#set page(margin: 1.5cm)`) becomes `margin: (right: 4cm, rest: 1.5cm)` with the first note: drafting needs room on the right.

== Why

Review happens in the document itself: the notes stay with the text they are about, in every copy and every branch, without a separate review tool.

== How to configure

- The option `user` names who signs the notes (@reference-configuration-options).
- "Comments" in the View menu hides the notes in the preview (@features-rendering-preview).
- Export option `comments.include` (off by default): the notes in the PDF (@features-pdf).
