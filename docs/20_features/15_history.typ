= History and changes <features-history>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

In a project from GitLab (@features-gitlab), the side panel *History* (the clock on the left rail) lists the commits of the project, newest first.

- *On top: "Not in GitLab yet"*, the files changed since the last commit. Click it to list them.
- *Each commit* shows the initials of its author and co-authors, its first line, how long ago and its short id, grouped by day. "Load more" shows older commits.
- *Click a commit* to list the files it changed (A added, M modified, D deleted, R renamed). Click a file to open its tab *Changes*: the file's text with deleted lines in red and new text in green, read-only. Without a commit chosen, the tab shows what changed since the last commit.
- *History of a file or folder:* right click it in the file panel → "Show history". ✕ in the panel goes back to the whole project. A project in a folder of the repository shows the folder's history.

*Changes since a commit:* the flag beside a commit ("Show changes since this commit") makes the Visual editor's "Show changes" compare with that commit instead of the last one. The panel says so on top; "Since last commit" there, or the toolbar button with the arrow, goes back.

