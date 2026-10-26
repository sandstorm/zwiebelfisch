#import "../template.typ": mermaid, unreviewed

= GitLab integration <configuration-gitlab-integration>

#unreviewed

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back; `gitlab:<project>@<branch>:/<folder>` holds one folder of it (@configuration-gitlab-integration-folder). People sign in with their GitLab account (@configuration-collaboration-server-sign-in), and the server does everything in their name, with their own token: it has no GitLab account of its own.

```ts
createEditor(host, {
  mainFile: { path: '/thesis.typ' },   // the repository's main file; no source or files needed
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://editor.example.org', room: 'gitlab:group/thesis@main' }),
  ],
});
```

Configure the server with environment variables, e.g. in a git-ignored `mise.local.toml` (*never commit the secrets*), together with the sign-in's (`ZWF_AUTH_CLIENT_ID`, `ZWF_AUTH_CLIENT_SECRET`: an application on this GitLab instance with the scopes `openid profile email read_api write_repository`):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`ZWF_GITLAB_URL`], [Required: the GitLab instance, e.g. `https://gitlab.com`.],
  [`ZWF_GITLAB_WEBHOOK_SECRET`], [Enables the push webhook: add one in the GitLab project (_Settings → Webhooks_, _Push events_) with the URL `https://<server>/api/public/gitlab/webhook` and this secret as its token.],
  [`ZWF_GITLAB_AUTHOR_EMAIL`], [An editor's email in commits when theirs is unknown, and the committer's.],
  [`ZWF_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`); `off`: only "Save to GitLab…".],
)

- *Who may edit:* members of the project with the Developer role or more, as GitLab tells the user with their own token when they join (`read_api`; the answer is kept a minute). Others are refused, and the widget says why.
- *Who may save:* who may also push to the branch, as GitLab tells them (protected branches included), asked again on every save.
- *Commits are the saver's:* the user who saves is the author and pushes with their token (`write_repository`); the other editors are `Co-authored-by:` trailers; the committer is Zwiebelfisch.
- *Saving by itself* (after `ZWF_GITLAB_AUTO_COMMIT` minutes without edits, after the last user left, and when an editor signs out): only if everyone whose edits it contains may push (each asked afresh, with their own token, so each must still be signed in). The commit is by the editor who left last, else who edited most. Otherwise the room says why and waits for a save by someone who may.
- *Guests* (`ZWF_GUESTS=1`, @configuration-collaboration-server-guests): who may edit the room may share it with guests by a link. Guests have no GitLab token: they edit (Typst files, images, Mermaid diagrams and spreadsheets only; every other file is read-only to them), never save ("Guests cannot save; a member saves your edits."), and cannot pull in files from outside a room's folder. A member's save commits their edits, with each guest a co-author (`Co-authored-by: Jane (guest) <ZWF_GITLAB_AUTHOR_EMAIL>`, never an email the guest typed). Edits with a guest's among them are not saved by themselves: the status says "Guest edits: a member must save".
- *Tokens live in memory only:* never in the database, the git clones, a log or an error. A restart signs everyone out: the rooms keep their changes, and a room saves by itself again once everyone whose changes it holds is signed in again (or someone who may push saves).
- *The repositories* are full git clones in `repositories/` next to `ZWF_COLLAB_DB` (in memory with `:memory:`), one per project and holding the branches of its rooms. Rooms read files from them only (at most 32 MiB each).
- Other room names (plain rooms) need `ZWF_PLAIN_ROOMS=1` (@configuration-collaboration-server-running).
- Files other than `.typ` are fetched from the server (`GET /api/rooms/<room>/files/<path>`, with the session cookie, as the room), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.

== A project in a folder of the repository <configuration-gitlab-integration-folder>

The room `gitlab:<project>@<branch>:/<folder>` holds one folder of the branch, e.g. `gitlab:group/reports@main:/2026/q1` for a report next to others that share `/template.typ`. The folder is absolute, without `..`, `.git` or empty parts (a branch name holds no `:`). Paths stay the repository's: the files are `/2026/q1/main.typ` and `/template.typ`, and Typst's root is the repository's, so `#import "/template.typ"` works as in a checkout.

- *What reaches the browser:* the folder's files, and the files from outside it that the room pulled in. Nothing else of the repository.
- *Pulling in:* when a compile misses a file outside the folder (an import, an image), the widget asks the server for it (`gitlab:pull`). The server adds it if the branch has it at the room's base, else answers that it is not in the repository (asked once per file and base commit). Package imports (`@preview/…`) are not repository files.
- *Caps:* at most 200 pulled-in files per room, each at most 32 MiB.
- *Pulled-in files* are kept in the room (`meta.pulledIn`), so they are there at once on the next load. They are saved, merged and conflict like the folder's files; other upstream changes outside the folder leave the room alone (its base commit moves on).
- *The main file* is the folder's `main.typ`, else its first `.typ` file (unless the host fixes `mainFile`). The host's own files outside the folder are not added to the room.

#figure(
  mermaid(read("../diagrams/gitlab-room-folder.mmd"), width: 80%),
  caption: [What of the repository a room of one folder holds.],
)
