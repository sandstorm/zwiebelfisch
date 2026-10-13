= GitLab integration <configuration-gitlab-integration>

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back. People sign in with their GitLab account (@configuration-collaboration-server-sign-in); whoever edited is named as a co-author of the commits.

```ts
createTypstEditor(host, {
  mainFile: { path: '/thesis.typ' },   // the repository's main file; no source or files needed
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://editor.example.org', room: 'gitlab:group/thesis@main' }),
  ],
});
```

Configure the server with environment variables, e.g. in a git-ignored `mise.local.toml` (*never commit the token or the secret*), together with the sign-in's (`TYPST_AUTH_CLIENT_ID`, `TYPST_AUTH_CLIENT_SECRET`: an application on this GitLab instance):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`TYPST_GITLAB_URL`], [Required: the GitLab instance, e.g. `https://gitlab.com`.],
  [`TYPST_GITLAB_TOKEN`], [Required: a bot's token with `api` scope, the author of every commit; its user should be a Maintainer of the projects (it reads their protected branches). Clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Enables `POST /gitlab/webhook`: add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [An editor's email in the `Co-authored-by:` trailers when theirs is unknown.],
  [`TYPST_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`); `off`: only "Save to GitLab…".],
)

- *Who may edit:* members of the project with the Developer role or more (checked with the bot's token when they join; the answer is kept a minute). Others are refused, and the widget says why.
- *Who may save:* who may also push to the branch: a protected branch's rules (roles, users, groups; wildcards) are checked again on every save, since the bot would bypass them.
- Commits are the bot's; everyone who edited is a `Co-authored-by:` trailer. No user's token is used for them, and none is stored.
- Other room names (plain rooms) need `TYPST_PLAIN_ROOMS=1` (@configuration-collaboration-server-running).
- Files other than `.typ` are fetched from the server (`GET /rooms/<room>/files/<path>`, with the session cookie, as the room), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.
