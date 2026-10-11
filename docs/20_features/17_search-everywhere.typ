= Search everywhere <features-search-everywhere>
#set heading(outlined: false)

== What it does

#import "../template.typ": screenshot
#screenshot("search-everywhere")

Press Shift twice, anywhere (also while typing in an editor), or click the magnifier on the left rail, below the files. One list finds everything, grouped; type a few letters of a word, in order (`cmptim` finds "Compile times"). Arrows and Enter pick, Escape closes.

- `#method` jumps to the "Method" chapter; `@runs` finds the table captioned "Runs"; `%linearly` finds the sentence in any chapter; `!grace` lists the notes Grace wrote in; `:theme` asks for light, dark or automatic colors.

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

- Without a prefix each group shows its best 5 ("12 more · type \#" says how to see all); a prefix shows only its groups, up to 100 each.
- A setting changed here holds for this editor until the page sets the settings again.

== Why

In a project of many files, a heading, a figure or a sentence is a few keys away, without knowing which file it is in; so is every command and setting.

== How to configure

Nothing to configure. What it finds comes from the extensions: each adds its group.
