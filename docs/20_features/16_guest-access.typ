= Guest access <features-guest-access>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

A member shares one project with people who have no account, by a link: *guests* edit it with everyone else, members save their edits. The server must allow it (`ZWF_GUESTS=1`, @configuration-collaboration-server-guests).

*Share:* "Share" (the title bar's right end) asks whom the link is for ("ACME reviewers") and how long it works: 1, 7 (preselected) or 30 days. The link is copied and shown once; it cannot be shown again. One link serves a group: each guest names themselves. A project has at most 10 links at a time.

*Join:* the guest opens the link and enters their name (offered again next time). Others see them as "Jane (guest)": their carets and boxes are dashed. Someone signed in needs no link and stays who they are.

*A guest sees that they are one, all the time:*
- the title bar in the warning color, starting with "Guest access · until Oct 25, 18:00" (who shared it in its tooltip); red with a countdown in the last hour ("Guest access · ends in 12 min (18:00)"), and once it has ended
- a frame around the editor in the same color
- no "Save to GitLab…" and no "Share": members save. "Leave guest access" in the account's menu ends it.

*A guest gets the project and nothing else:* its files (in a project of one folder, the folder and the files it uses from outside it), their history, and no other project.

*What a guest may change:* Typst files, images (PNG, JPG, GIF, SVG, WebP), Mermaid diagrams (`.mmd`) and spreadsheets (`.ic`): edit, create, rename, delete. Every other file (the CI configuration, bibliographies, data such as `.csv` or `.json`) is read-only to them: it opens as "refs.bib (read-only)", stays where it is, and creating one is refused ("notes.md cannot be created here: it would be read-only."). The server enforces it: a guest's change to such a file is undone at once and the guest is put out of the project.

*Members see that the project is shared:* while it has links, "Share" says "Shared · 2 guests" (until when, and how many are online, in its tooltip).

*Manage and revoke:* the links belong to the project, not to who made them. While there are links, "Share" (or "Manage guest links…") lists this project's guest links, the same for every member: who made each, until when, and who of its guests is in; it also offers "New guest link…". Picking one revokes it: its guests are out at once and told so. Any member who may share revokes any link of the project.

*A link ends with its creator's access:* when GitLab says its creator may no longer edit the project, their links end, also while they are signed out (another signed-in member's sign-in asks GitLab). Only when nobody signed in can ask does a link go on.

*Saving guest edits:* guests are co-authors of the commit ("Co-authored-by: Jane (guest)"). The project does not save by itself while it has guest edits: the title bar's save status says "Guest edits: a member must save".
