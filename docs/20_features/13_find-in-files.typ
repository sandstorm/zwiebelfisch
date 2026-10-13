= Find in files <features-find-in-files>
#set heading(outlined: false)

#import "../template.typ": screenshot

#screenshot("find-in-files")

*Press ⌘⇧F* (or click the magnifier on the left rail) to find a text in every file of the project, listed by file and line. It starts with the selected text.

- *What is searched:* the Typst source of every `.typ` file and every text file (`.bib`, `.csv`, `.json`, `.md`, …), not images or PDFs. Searching `*quick* fox` finds the bold markup.
- *Options* beside the field: Match Case (`Aa`), Match Whole Word (`ab`), Use Regular Expression (`.*`).
- *In:* the project, the current file, or a folder. Right click a folder in the file panel → "Find in folder…".
- *Each result* shows its line between the line before and after it; nearby results share them.
- Results *update while you type*, and when you or your co-authors change a file.

*Opening a match:* click it, or press Enter on its row. It opens selected in the editor you are working in, Visual or Source. While the panel is open, both editors *highlight every match*.

== Replace

*Press ⌘⇧H*, or click "Replace" in the panel's header. Each match shows struck through, its replacement after it. With regular expressions, `$1` in the replace text inserts the first group.

- ⇄ beside a match replaces that match, "Replace" on a file's row all of its matches.
- "Replace all" replaces everything; a big replace asks first.
- *Undo* beside the outcome takes back the whole replace, in every file at once.

== Keyboard shortcuts

Menus, tooltips and the command rows of search everywhere (`>`) show each command's key, too.

#table(
  columns: 2,
  [Action], [Key],
  [Find in files], [⌘⇧F],
  [Replace in files], [⌘⇧H],
  [Search everywhere], [Shift twice, ⌘P],
  [Search everywhere: files], [⌘⇧O],
  [Search everywhere: commands], [⌘⇧A],
  [Show / hide the file panel], [⌃1 (Alt+1 on Windows)],
  [Show / hide Find in files], [⌃3 (Alt+3 on Windows)],
  [Back / forward], [⌃- / ⌃⇧-],
  [Add comment], [⌘⌥M],
  [Replace all (in the panel)], [⌥⌘↩],
  [Replace the row's match or file (in the panel)], [⇧⌘1],
)

While you are in the editor, these keys are the editor's, not the browser's: ⌘P opens search everywhere instead of printing. On Linux, the browser keeps Alt+1 and Alt+3 for its tabs. The Highlight mark has no key (⌘⇧H is Replace); use the toolbar.
