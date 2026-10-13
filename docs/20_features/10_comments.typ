= Comments <features-comments>
#set heading(outlined: false)

#import "../template.typ": screenshot

Comments are notes in the margin, as in a word processor. They are stored in the Typst source as #link("https://typst.app/universe/package/drafting/")[drafting] margin notes, so they travel through saves, git and diffs like any other text.

#screenshot("comments")

*Select some text and click the comment icon in the balloon toolbar, or press ⌘⌥M*.

The file then contains:

```typ
#import "@preview/drafting:0.2.2": margin-note

// one list item per message, signed with your name and the date
Cold compile time #margin-note[grows linearly][- *Ada* (2026-10-10): Add the 500-page run.
- *Grace* (2026-10-11): Running it tonight.] with the page count.
```

- Click the speech bubble or the highlighted text to open the note's card.
- On the card: reply, edit or delete your own messages, and "Resolve" (deletes the note).
- Type `!` in search everywhere to find notes by text or author.
- The preview shows the notes in the page margin.
