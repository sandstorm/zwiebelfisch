= GitLab <features-gitlab>
#set heading(outlined: false)

== What it does


A room can be a branch of a GitLab repository: everyone in it edits the branch's files together, and the changes go back to GitLab as commits.

- *What is not in GitLab yet* is always visible: the status bar says "Not in GitLab: 3 files · 14 min (Ann, Bob)" (how many files, since the first edit, who edited), or "Saved · 01234567" (the branch's commit). The file panel marks changed files M, new ones A (a deleted file has no row; it counts). A click on the status saves.
- *Saving:* "Save to GitLab…" in the tab bar (or a click on the status) asks for a commit message (default "Edit via Typst editor"). Every change since the last commit, uploads included, becomes one commit by the saving user; the others who edited since are `Co-authored-by:`.
- *Saving by itself* (on by default): when nobody edited for 10 minutes, and 20 s after the last user left (a reload in between does not count). One commit on the branch itself (no side branch, no squashing), by whoever made the most edits, the others as co-authors: "Edits by Ann, Bob: chapters/intro.typ, results.typ" (at most three files named). Use "Save to GitLab…" for a meaningful message.
- Everyone in the room sees the outcome: "Saved version 01234567 (Ann)", "Saved version 01234567 automatically (Bob)", "No changes to save", "Saving failed: …".
- *Saving fails* (GitLab unreachable, or refusing the commit; a click or by itself): everyone sees the message, and the status bar warns "Saving to GitLab failed" (also who joins later) until a save or a merge of changes on GitLab succeeds. The changes stay in the room; a click on the warning saves again.
- *Leaving:* the last user leaving with changes not in GitLab gets the browser's "Leave site?" question when nothing would save them: saving by itself is off, a conflict blocks it, or the last save failed. The changes stay in the room either way.
- *Changes on GitLab* (pushes, merges) are merged into the room file by file, three-way: when someone saves, and on push with the webhook.
- *Conflicts:* where the room and GitLab changed the same lines, nothing is merged or committed, also not by itself. Everyone sees "Changes on GitLab conflict with edits in …", and until it is resolved a warning "Conflict with GitLab: main.typ" in the status bar and "!" on the files (also who joins later). The room keeps its text, without conflict markers. Make the lines match (here or on GitLab), then save again; saving by itself retries after the next edits.
- Text files other than `.typ` (CSV, `.bib`, …) are shared whole: when two people type in one at once, the last save wins.

Trying it: the demo's "GitLab (fake)" mode, or `?room=gitlab:demo/report@main`.

== Why

The document stays in the repository it belongs to, with history, reviews and merge requests, while authors who never use git edit it in the browser.

== How to configure

- The host joins the room `gitlab:<project id or path>@<branch>` with the `collaboration` extension; `user` is the commit author.
- The server needs the GitLab instance and a token; the minutes before saving by itself are `TYPST_GITLAB_AUTO_COMMIT` (`off`: only "Save to GitLab…"): @configuration-gitlab-integration.
