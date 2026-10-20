#import "../template.typ": unreviewed

= GitLab integration <configuration-gitlab-integration>

#unreviewed

A collaboration room (@configuration-collaboration-server) can be a branch of a GitLab repository: the room `gitlab:<project id or path>@<branch>` loads the branch and commits the changes back. People sign in with their GitLab account (@configuration-collaboration-server-sign-in); whoever edited is named as a co-author of the commits.

```ts
createEditor(host, {
  mainFile: { path: '/thesis.typ' },   // the repository's main file; no source or files needed
  extensions: (builtinExtensions) => [
    ...builtinExtensions,
    collaboration({ url: 'wss://editor.example.org', room: 'gitlab:group/thesis@main' }),
  ],
});
```

Configure the server with environment variables, e.g. in a git-ignored `mise.local.toml` (*never commit the token or the secret*), together with the sign-in's (`ZWF_AUTH_CLIENT_ID`, `ZWF_AUTH_CLIENT_SECRET`: an application on this GitLab instance):

#table(
  columns: 2,
  [Variable], [Meaning],
  [`ZWF_GITLAB_URL`], [Required: the GitLab instance, e.g. `https://gitlab.com`.],
  [`ZWF_GITLAB_TOKEN`], [Required: a bot's token with `api` scope, the author of every commit; its user should be a Maintainer of the projects (it reads their protected branches). Clients never see it.],
  [`ZWF_GITLAB_WEBHOOK_SECRET`], [Enables the push webhook: add one in the GitLab project (_Settings → Webhooks_, _Push events_) with the URL `https://<server>/api/public/gitlab/webhook` and this secret as its token.],
  [`ZWF_GITLAB_AUTHOR_EMAIL`], [An editor's email in the `Co-authored-by:` trailers when theirs is unknown.],
  [`ZWF_GITLAB_AUTO_COMMIT`], [Minutes without edits before a room saves by itself (default `10`); `off`: only "Save to GitLab…".],
)

- *Who may edit:* members of the project with the Developer role or more (checked with the bot's token when they join; the answer is kept a minute). Others are refused, and the widget says why.
- *Who may save:* who may also push to the branch: a protected branch's rules (roles, users, groups; wildcards) are checked again on every save, since the bot would bypass them.
- Commits are the bot's; everyone who edited is a `Co-authored-by:` trailer. No user's token is used for them, and none is stored.
- Other room names (plain rooms) need `ZWF_PLAIN_ROOMS=1` (@configuration-collaboration-server-running).
- Files other than `.typ` are fetched from the server (`GET /api/rooms/<room>/files/<path>`, with the session cookie, as the room), so it must be reachable over HTTP too.
- Saving and conflicts, as users see them: @features-gitlab.
