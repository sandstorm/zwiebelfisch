= GitLab integration <configuration-gitlab-integration>

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back.

```ts
createTypstEditor(host, {
  mainFile: { path: '/thesis.typ' },   // the repository's main file; no source or files needed
  user: { name: 'Ada' },               // named as a co-author of the commits
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token }),
  ],
});
```

Configure the server with environment variables, e.g. in a git-ignored `mise.local.toml` (*never commit the token*):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`TYPST_GITLAB_URL`], [Required: the GitLab instance, e.g. `https://gitlab.com`.],
  [`TYPST_GITLAB_TOKEN`], [Required: a bot's token with `api` scope, the author of every commit. Clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Enables `POST /gitlab/webhook`: add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [An editor's email in the `Co-authored-by:` trailers when theirs is unknown.],
  [`TYPST_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`); `off`: only "Save to GitLab…".],
)

- Commits are the bot's; everyone who edited is a `Co-authored-by:` trailer. No user's token is used or stored.
- Other room names (plain rooms) need `TYPST_PLAIN_ROOMS=1` (@configuration-collaboration-server-running).
- Files other than `.typ` are fetched from the server (`GET /rooms/<room>/files/<path>`, the token as `Authorization: Bearer`), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.
