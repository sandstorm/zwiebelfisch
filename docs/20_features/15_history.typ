= History and changes <features-history>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

*Show changes:* in a project from GitLab (@features-gitlab), the editors mark what changed, as IntelliJ's "Show changes" does. One comparison at a time, everywhere alike:

#table(
  columns: (auto, 1fr, auto),
  table.header[What][How][The files],
  [The changes since the last commit], [View → "Show changes since last commit"], [as they are now, editable],
  [The changes of one commit], [click it in History], [as they were at that commit, read-only],
  [The changes from one commit to another], [click one, then Cmd-click (Ctrl-click) the other: always from the older to the newer], [as they were at the newer, read-only],
  [The changes since a commit, to now], [right click it in History → "Compare with current state"], [as they are now, editable],
)

- *Visual editor:* new text green and underlined, deleted text struck through in red, where it was.
- *Source editor* (and text files): changed lines green, deleted lines in red above them, read-only.
- *A file as it was at a commit* opens in the same editors, without the toolbar, read-only. The tab bar names it: "84c6e2f · read-only · changes since ebd0bc4"; click that to open the file as it is now. A file the commit deleted shows its earlier text, all struck through. The preview keeps showing the project as it is now.
- *Images and other files* without a text editor show nothing.
- *The status bar names the comparison:* "Changes since last commit ✕", "Changes in 84c6e2f ✕", "Changes from ebd0bc4 to 84c6e2f ✕", "Changes since 3f2a91c (2 days ago) ✕". Click it, or the menu entry again, to turn the marks off. A file shown as it was goes back to the file as it is now.
- It stays on as you set it, also on your next visit (then since the last commit).

The side panel *History* (the clock on the left rail) lists the commits of the project, newest first.

- *On top it says the comparison:* "● Changes in 84c6e2f “Fix the letter”", "Changes from ebd0bc4 to 84c6e2f", "Changes since 84c6e2f (to now)" or "Changes since last commit", with ✕ to end it; while off, "Show changes since last commit" turns them on. It is the same switch as the menu entry and the status bar: whichever you use, all agree at once.
- *Then "Not in GitLab yet"*, the files changed since the last commit. Click it to list them; click a file to open it with the changes since the last commit shown.
- *Each commit* shows one round badge with its author's initials ("+1" when there are co-authors), its first line (all of it in the tooltip), and below the names, how long ago and its short id, grouped by day. "Load more" shows older commits.
- *Click a commit* to show its changes. It is highlighted, labelled "Changes", and lists the files it changed: #text(green)[+] added, #text(red)[−] deleted, #text(orange)[\~] modified, → renamed; long folders are cut at the left so the file name stays visible. Click a file to open it as it was there. *Click it again* to stop.
- *Cmd-click (Ctrl-click) another commit* to compare the two: they are labelled "From" and "To", and "To" lists the files that differ.
- *Right click a commit* for "Show changes of this commit", "Compare with current state" (labelled "Since"; it lists the files changed since, and opens them as they are now) and "Compare with…": the next commit you click is the other end.
- *History of a file or folder:* right click it in the file panel → "Show history". ✕ in the panel's title goes back to the whole project. A project in a folder of the repository shows the folder's history.
