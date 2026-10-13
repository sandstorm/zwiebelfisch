= GitLab integration <configuration-gitlab-integration>

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the server loads the branch and commits the room's changes back.

With the server configured for GitLab, the room `gitlab:<project id or path>@<branch>` is that branch:

```ts
createTypstEditor(host, {
  main: '/thesis.typ',      // the repository's main file; no source or files needed
  user: { name: 'Ada' },    // the commit author
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://collab.example.org', room: 'gitlab:group/thesis@main', token }),
  ],
});
```

- *Loading:* the first user to open the room makes the server load the branch. `.typ` files become shared text; the widget fetches the other files from the server (`GET /rooms/<room>/files/<path>`, token as `Authorization: Bearer`).
- Saving, merging and conflicts as the users see them: @features-gitlab.

Server configuration, e.g. in a git-ignored `mise.local.toml` `[env]` section (never commit the token):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`TYPST_GITLAB_URL`], [The GitLab instance, e.g. `https://gitlab.com`.],
  [`TYPST_GITLAB_TOKEN`], [Server-side token with `api` scope; clients never see it.],
  [`TYPST_GITLAB_WEBHOOK_SECRET`], [Optional: enables `POST /gitlab/webhook`. Add a push webhook with this secret in the GitLab project.],
  [`TYPST_GITLAB_AUTHOR_EMAIL`], [Optional: the author email when the user's is unknown.],
  [`TYPST_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`; fractions allowed); `off`: only "Save to GitLab…".],
)

GitLab rooms need both `TYPST_GITLAB_URL` and `TYPST_GITLAB_TOKEN`.
