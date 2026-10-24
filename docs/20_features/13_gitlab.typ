
= GitLab <features-gitlab>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

A project can be a branch of a GitLab repository: everyone edits the branch's files together, and the changes go back to GitLab as commits.

*Sign in with GitLab:* the status bar's "Sign in". You edit a project when you are a Developer (or more) in it, and save when you may push to its branch.

*The status bar shows what is not in GitLab yet*, e.g. "Not in GitLab: 3 files · 14 min (Ann, Bob)". The file panel marks changed files M and new ones A.

*See what changed since the last commit:* View → "Show changes since last commit" marks new text green and deleted text struck through in red, in the Visual and the Source editor. The status bar says since when; click it to stop. Older commits are in the History panel (@features-history).

*Click "Save to GitLab…"* to commit every change since the last commit, with a message you enter.

*It saves by itself* when nobody edited for 10 minutes, when the last user leaves, and when you sign out; only if everyone who edited may push to the branch and is still signed in, else someone who may must save.

*Commits are the saver's:* you are the author of what you save, in your GitLab account's name; everyone else who edited is named as a co-author.

*The main file is your own:* "Set as main file" changes it for you only.

*Changes on GitLab* (pushes, merges) are merged into the open project.

*A project can be a folder of the repository:* the file panel shows the repository's paths. The folders around the project's folder are read-only: new files and folders go into the project's folder, and files outside it are not renamed, moved or deleted.

*Shared files:* a file from outside the project's folder that the project uses (`#import "/template.typ"`, an image) is loaded once a compile asks for it. It is marked S (used from outside this project's folder): you edit it as any file, and the change is saved to GitLab for everyone who uses it.

*Conflicts must be resolved by hand:* where the project and GitLab changed the same lines, nothing is merged or saved. The status bar warns "Conflict with GitLab: main.typ". Make the lines match, here or on GitLab, then save again.

To try it, use the demo's "GitLab (fake)" mode; `?room=gitlab:demo/report@main:/letters/welcome` opens a project in a folder that uses the report's template.
