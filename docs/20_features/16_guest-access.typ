= Guest access <features-guest-access>

#import "../template.typ": unreviewed
#unreviewed
#set heading(outlined: false)

A member shares one project with people who have no account, by a link: *guests* edit it with everyone else, members save their edits. The server must allow it (`ZWF_GUESTS=1`, @configuration-collaboration-server-guests).

*Share:* "Share with guests…" (the editing area's toolbar) asks whom the link is for ("ACME reviewers") and how long it works: 1, 7 (preselected) or 30 days. The link is copied and shown once; it cannot be shown again. One link serves a group: each guest names themselves. A project has at most 10 links at a time.

*Join:* the guest opens the link and enters their name (offered again next time). Others see them as "Jane (guest)": their carets and boxes are dashed. Someone signed in needs no link and stays who they are.

*A guest sees that they are one, all the time:*
- a banner that cannot be closed: "Guest access · shared by Ann · ends in 2 days (Oct 25, 18:00)", red with a countdown in the last hour
- a frame around the editor and a "GUEST · 2 d left" badge in the status bar
- no "Save to GitLab…": members save. "Leave guest access" in the account's menu ends it.

*A guest gets the project and nothing else:* its files (in a project of one folder, the folder and the files it uses from outside it), their history, and no other project.

*Members see that the project is shared:* while it has links, a thin banner "Shared with guests · 2 online · until Oct 30" with "Manage…", and a "Shared · 2 guests" badge.

*Manage and revoke:* "Manage…" (or the badge, or "Manage guest links…") lists the links with who made them, until when, and who of their guests is in. Picking one revokes it: its guests are out at once and told so. Any member who may share revokes any link of the project.

*Saving guest edits:* guests are co-authors of the commit ("Co-authored-by: Jane (guest)"). The project does not save by itself while it has guest edits: the status bar says "Guest edits: a member must save".
