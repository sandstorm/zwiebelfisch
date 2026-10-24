= History and changes <features-history>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

*Show changes since …:* in a project from GitLab (@features-gitlab), View → "Show changes since last commit" marks in the editors what changed since a commit. You keep editing as usual; the marks follow.

- *Visual editor:* new text green and underlined, deleted text struck through in red, where it was.
- *Source editor* (and text files): changed lines green, deleted lines in red above them, read-only.
- *Images and other files* without a text editor show nothing.
- *The status bar says since when:* "Changes since last commit ✕", or "Changes since 3f2a91c (2 days ago) ✕". Click it, or the menu entry again, to turn the marks off; the next time they start again from the last commit.
- It stays as you set it, also on your next visit.

The side panel *History* (the clock on the left rail) lists the commits of the project, newest first.

- *On top it says the mode:* "● Showing changes since 3f2a91c “Fix the letter”" (or "since last commit") with ✕ to stop showing them; while off, "Show changes since last commit" turns them on. It is the same switch as the menu entry and the status bar: whichever you use, all three agree at once.
- *Then "Not in GitLab yet"*, the files changed since the last commit. Click it to list them; click a file to open it with the changes since the last commit shown.
- *Each commit* shows one round badge with its author's initials ("+1" when there are co-authors), its first line (all of it in the tooltip), and below the names, how long ago and its short id, grouped by day. "Load more" shows older commits.
- *Click a commit* to show the changes since it, in every editor (it turns the marks on). The commit is highlighted, labelled "Compared", and lists the files it changed: #text(green)[+] added, #text(red)[−] deleted, #text(orange)[\~] modified, → renamed; long folders are cut at the left so the file name stays visible. Click a file to open it.
- *Click another commit* to compare with that one instead; *click the compared commit again* to stop showing changes.
- *History of a file or folder:* right click it in the file panel → "Show history". ✕ in the panel's title goes back to the whole project. A project in a folder of the repository shows the folder's history.
