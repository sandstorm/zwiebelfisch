#import "/template.typ": unreviewed

= GitLab integration <configuration-gitlab-integration>

#unreviewed

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back.

```ts
createTypstEditor(host, {
  mainFile: { path: '/thesis.typ' },   // the repository's main file; no source or files needed
  user: { name: 'Ada' },               // the commit author
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
  [`TYPST_GITLAB_TOKEN`], [Required: a token with `api` scope. Clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Enables `POST /gitlab/webhook`: add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [The author email when the user's is unknown.],
  [`TYPST_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`); `off`: only "Save to GitLab…".],
)

- Files other than `.typ` are fetched from the server (`GET /rooms/<room>/files/<path>`, the token as `Authorization: Bearer`), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.
