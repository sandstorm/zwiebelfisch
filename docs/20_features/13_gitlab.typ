= GitLab <features-gitlab>
#set heading(outlined: false)

A project can be a branch of a GitLab repository: everyone edits the branch's files together, and the changes go back to GitLab as commits.

*The status bar shows what is not in GitLab yet*, e.g. "Not in GitLab: 3 files · 14 min (Ann, Bob)". The file panel marks changed files M and new ones A.

*Click "Save to GitLab…"* to commit every change since the last commit, with a message you enter.

*It saves by itself* when nobody edited for 10 minutes, and when the last user leaves.

*Commits are the server's:* their author is the server's GitLab account; everyone who edited is named as a co-author.

*The main file is your own:* "Set as main file" changes it for you only.

*Changes on GitLab* (pushes, merges) are merged into the open project.

*Conflicts must be resolved by hand:* where the project and GitLab changed the same lines, nothing is merged or saved. The status bar warns "Conflict with GitLab: main.typ". Make the lines match, here or on GitLab, then save again.

To try it, use the demo's "GitLab (fake)" mode.
