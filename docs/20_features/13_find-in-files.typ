= Find in files <features-find-in-files>
#set heading(outlined: false)

#import "../template.typ": screenshot

== What it does

#screenshot("find-in-files")

The panel "Find in files" (the magnifier on the left rail, after Files) finds every occurrence of a text in the project and lists them by file and line; in Replace mode it replaces them.

*Press Ctrl+Shift+F* (⌘⇧F on Mac) to find, *Ctrl+Shift+H* (⌘⇧H) to replace. Both start from the selected text (one line); in the panel they switch between the two modes, as the "Find" / "Replace" buttons in its header do. The mode is remembered; the query, the options and where to search stay when it changes.

- *What is searched:* the Typst source of every `.typ` file, and every text file (`.bib`, `.csv`, `.json`, `.yaml`, `.toml`, `.xml`, `.txt`, `.md`, `.mmd`); never images, PDFs or fonts. Always the source: `*quick* fox` is found, "quick fox" in it is not.
- *Options* beside the field: Match Case (`Aa`), Match Whole Word (`ab`), Use Regular Expression (`.*`). An invalid regular expression says why under the field and finds nothing. `\n` in a regular expression searches across lines.
- *In:* Project; Current file (the one shown, following as you switch files); Folder (the current file's folder, with its subfolders, shown as a chip whose × goes back to Project). "Find in folder…" on a folder's row in the file panel (right click) searches that folder.
- *Results* follow your typing (after a short pause) and every change to the files, yours and your co-authors'. A row per file (name, folder, count; files with more than 10 matches start collapsed), below it a row per match: its line number and the source line, the match marked. More than 5000 matches: "Too many results — narrow the search".
- *Opening a match* (click, or Enter on its row): a Typst file opens in the editor you are working in, Visual or Source, the match selected. In the Visual editor, a match in markup it does not show as text (`*`, `#`, `=`) selects the text it formats; a match in math or other code opens that box's code with the match selected. A text file opens in its own editor, the match selected. In a narrow window the panel, lying over the editor, closes.
- While the panel is shown, the Visual and Source editors highlight every match it lists (orange), the one of the row the list is on brighter.
- The list is one stop for Tab: ↑ / ↓, Home / End move, ← / → collapse and expand a file, ↓ in the field goes to the first row.

=== Replace

Replace mode adds a replace field and shows each match struck through, its replacement after it. With Use Regular Expression on, the replace text takes the groups: `$1`, `$<name>`, `$&` (the whole match), `$$` (a `$`), and `\n`, `\t`.

- Replace a match: ⇄ beside its row (shown on hover). A file's matches: "Replace" on its row. All: "Replace all"; more than one file or 50 matches are confirmed first ("Replace 120 occurrences in 7 files?").
- A match whose text changed since it was found is left as it is: "Replaced 23 occurrences in 4 files · 2 matches changed meanwhile, not replaced".
- *Undo* beside that line takes back the whole replace, in every file at once, also in files no editor shows. A replacement edited since stays. Ctrl+Z in the Visual editor stays the undo of your own typing; in the Source editor it also takes back a replace in its file (the panel's Undo then leaves that file as it is).
- A replace in a Typst file is a set of exact edits: comments, co-authors' cursors and their typing elsewhere in the file are untouched. A text file the host refuses to change is named in the outcome.

== Keyboard shortcuts

The keys of the editor as a whole (not the Visual editor's formatting keys, @features-wysiwyg-editing). Search everywhere's command rows (`>`), the menus and the rail's tooltips show each command's key, too.

#table(
  columns: 3,
  [Action], [Windows, Linux], [Mac],
  [Find in files], [Ctrl+Shift+F], [⌘⇧F],
  [Replace in files], [Ctrl+Shift+H], [⌘⇧H],
  [Search everywhere], [Shift Shift, Ctrl+P], [⇧⇧, ⌘P],
  [Search everywhere: files (`/`)], [Ctrl+Shift+O], [⌘⇧O],
  [Search everywhere: commands (`>`)], [Ctrl+Shift+A], [⌘⇧A],
  [Show and focus the file panel (hide it while it has the focus)], [Alt+1 (Windows only)], [⌃1],
  [Show and focus Find in files (hide it while it has the focus)], [Alt+3 (Windows only)], [⌃3],
  [Back / forward (@features-multiple-files)], [Ctrl+Alt+- / Ctrl+Shift+-], [⌃- / ⌃⇧-],
  [Add comment (@features-comments)], [Ctrl+Alt+M], [⌘⌥M],
  [In Find in files: replace all], [Ctrl+Alt+Enter], [⌥⌘↩],
  [In Find in files: replace the row's match or file], [Ctrl+Shift+1], [⇧⌘1],
)

- While the focus is in the editor, these keys are the editor's, not the browser's: Ctrl+P opens search everywhere instead of printing (Download PDF gives the PDF).
- Linux browsers switch tabs with Alt+1 … Alt+8, so the panels have no key there; Ctrl+1 … Ctrl+9 (⌘1 … ⌘9) stay the browser's everywhere. On a Mac, ⌃1 / ⌃3 clash only with "Switch to Desktop 1 / 3" when that is turned on in the system settings.
- Ctrl+Shift+H (⌘⇧H) is Replace in files, so the Visual editor's Highlight mark has no key: use the toolbar.

== Why

Renaming a term, a label or a path across a book's chapters is one step, reviewed before it happens, and taken back as one. The search everywhere `%` group gives a glance at the lines holding a text; its last row, "Find in files: ‹query›", continues here.

== How to configure

Nothing to set. A host that does not want the panel leaves the extension `search` out (`extensions`, @architecture-built-in-extensions).
