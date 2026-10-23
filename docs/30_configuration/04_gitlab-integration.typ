#import "../template.typ": unreviewed

= GitLab integration <configuration-gitlab-integration>

#unreviewed

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back. People sign in with their GitLab account (@configuration-collaboration-server-sign-in), and the server does everything in their name, with their own token: it has no GitLab account of its own.

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
- *Tokens live in memory only:* never in the database, the git clones, a log or an error. A restart signs everyone out: the rooms keep their changes, and a room saves by itself again once everyone whose changes it holds is signed in again (or someone who may push saves).
- *The repositories* are git clones in `repositories/` next to `ZWF_COLLAB_DB` (in memory with `:memory:`), one per project. They hold commits and trees, and only the files rooms read: the `.typ` files, other files when asked for (at most 32 MiB each).
- Other room names (plain rooms) need `ZWF_PLAIN_ROOMS=1` (@configuration-collaboration-server-running).
- Files other than `.typ` are fetched from the server (`GET /api/rooms/<room>/files/<path>`, with the session cookie, as the room), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.
