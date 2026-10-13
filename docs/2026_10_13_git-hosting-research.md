# Git hosting research: commits, auto-commit, providers (2026-10-13)

Temporary working note (research for open questions 3–5 of `2026_10_13_gitlab-projects.md`). Distil into the docs, then delete.
Legend: (v) verified in the linked source, (r) recalled.

## 1. Who commits, with which token

I recommend option (a). Commits go through the REST Commits API with the saving user's own OAuth token, scope `api`, and the server leaves `author_name` and `author_email` out of the request. People who edited but did not save are credited with `Co-authored-by:` trailers, which the current code already adds. This keeps the current TS design. One code change is needed: `gitlab-api.ts` `commit()` currently always sends `author_name` and `author_email`, and with the user's token it should send neither.

Legend: (v) checked in the source given, (r) from memory, not checked.

### Facts that decide it

| # | Fact | Mark |
|---|---|---|
| F1 | `write_repository` is "pull and push … Uses Git-over-HTTP. Does not support API authentication." So the REST Commits API needs `api`. | (v) https://docs.gitlab.com/security/tokens/access_token_scopes/ |
| F2 | `api` is "complete read/write access to the API, including all groups and projects", plus the registries. | (v) https://docs.gitlab.com/integration/oauth_provider/ |
| F3 | Commits API: `author_name` and `author_email` are optional; "if omitted, the authenticated user becomes the author". `start_sha`, `last_commit_id` and `force` exist. | (v) https://docs.gitlab.com/api/commits/ |
| F4 | REST API commits count as web commits. Setting `author_*` "makes it possible to create commits on behalf of other users". When web-based signing is on, REST commits whose `author_name`/`author_email` differ from the user sending the request are **rejected**. | (v) https://docs.gitlab.com/user/project/repository/signed_commits/web_commits/ |
| F5 | A group or project can switch on web-based signing ("Sign web-based commits") since GitLab 18.10 (GA). Signed web commits get Committer = the instance email. Co-authors appear as `Co-authored-by:` (GitLab's own suggestion commits do this). | (v) same page |
| F6 | Push rules: "Commits created through the GitLab UI or API are allowed even without signatures." For commits GitLab signs, the committer-email rules check the Author field instead. A git push has to meet "Reject unverified users" (committer email = one of the user's verified emails) and "Reject unsigned commits". | (v) https://docs.gitlab.com/user/project/repository/push_rules/ |
| F7 | An OAuth token works for git over HTTPS as `https://oauth2:<token>@host/…` (recommended username `oauth2`). | (v) https://docs.gitlab.com/api/oauth2/ |
| F8 | OAuth access tokens last 2 h. A refresh "invalidates the existing access_token and refresh_token" (they rotate). | (v) https://docs.gitlab.com/api/oauth2/ |
| F9 | Applications can be owned by a user, a group or the instance. An instance-wide app can be "trusted", which skips the consent screen. | (v) https://docs.gitlab.com/integration/oauth_provider/ |
| F10 | Project/group access tokens create a bot user and its "contributions are associated with the bot user". GitLab.com needs Premium or Ultimate; self-managed works on any license. Default expiry 365 days, at most 400. | (v) https://docs.gitlab.com/user/project/settings/project_access_tokens/ |
| F11 | Fine-grained PATs are GA in GitLab 19.2: per-resource permissions, limited to selected projects or groups. They are PATs only; nothing says OAuth apps get them. | (v) https://about.gitlab.com/blog/fine-grained-pats/ |
| F12 | Protected branches and push rules apply to whoever's token makes the commit, whether by API or push. | (r) |
| F13 | GitLab links a commit to a user profile and avatar by matching the author email to that user's verified emails. | (r) |
| F14 | go-git and shallow clones: known "object not found" bugs when pushing or pulling from a depth-1 clone. Only go-git v6 (beta) supports `Filter: blob:none` for partial clones. | (v) https://github.com/src-d/go-git/issues/455, https://github.com/go-git/go-git/issues/305, https://github.com/go-git/go-git/issues/2409; v6 filter: search result only, not opened (kritika#625) |

### Options compared

| | (a) User OAuth `api` + REST Commits API | (b) User OAuth `write_repository` + git push (go-git) | (c) Service token, `author_*` = user | (d) Group/project access token or service account |
|---|---|---|---|---|
| User grants | `read_user` + `api` once (F2). A trusted instance app skips consent (F9) | `read_user` + `read_api` (for the chooser and access check) + `write_repository` | `read_user` + `read_api` only | nothing, but a Maintainer/Owner must create a token per project or group |
| If the token leaks | everything the user can reach through the API, all projects, 2 h (F8); the stored refresh token makes it long-lived | API read-only, plus push to every repo the user can push to | one server token that can write every project it is a member of; impersonates everyone | one bot, limited to one project or group (smallest) |
| Audit trail | author = user (F3); push event and activity under the user (r) | author/committer = user, push event under the user (r) | push event and committer are the bot (r); author shows the user (F13); the real actor is hidden | bot everywhere; the user appears only in the message or trailers |
| Protected branches | the user's own rights apply (F12): correct | same | the bot's rights apply: a user without push access could save through the bot. Our access check has to replace GitLab's | same as (c) |
| Push rules | email/verified rules check the Author for API commits (F5, F6); passes, since it is the user | the committer email must be the user's verified email (F6). We need their commit email (`/user` → `commit_email` (r)) | "Check whether the author is a GitLab user" passes, so it looks fully legitimate | same as (c) |
| Signed commits | signed by the instance when the project enables it (F4, F5); "Reject unsigned" does not block API commits (F6) | unsigned, because the server has no user key. **Blocked** by "Reject unsigned commits" | **Rejected** when web signing is on (F4) | same as (c) when `author_*` is set; fine when the bot is the author |
| Self-managed | yes (Commits API is old (r)) | yes | yes | yes, any license (F10); GitLab.com: Premium+ |
| Room where A and B edited, B saves | author B, `Co-authored-by: A` (current `withCoAuthors`) | same | the author can be anyone, which is what makes it spoofing | author = bot, both in trailers |
| Server cost | one HTTP call per save. `last_commit_id` per file gives conflict detection (already used) | needs the base commit and trees locally: shallow fetch with `blob:none`, which is go-git v6 beta only (F14), plus shallow-push bugs, a disk cache per room, and our own conflict handling (non-fast-forward means fetch and merge again) | one call | one call |
| Auto-commit after everyone left | the stored refresh token of the top editor (rotates, so it is a DB write per refresh) | same | trivial | trivial |

Notes:
- (b) is a narrower grant on paper (no API write), but it fails against the "Reject unsigned commits" push rule. It also adds a git object store and go-git shallow-clone risk, and the API reading of tree/blob/branches stays anyway. It does not pay off.
- (c) is what `TYPST_GITLAB_TOKEN` does today. GitLab itself calls it creating commits "on behalf of other users" (F4). It breaks on projects with web-based signing on. It also bypasses per-user branch protection, which is the worst property here.
- (d) is the closest GitLab has to a GitHub App: a bot token per project or group, with the user only in trailers. There is no installation model and no tokens that act as the user. It suits optional server-side work (webhooks, auto-commit fallback) where a Maintainer sets it up per project. It is not a good default author.
- GitHub, if a second provider comes later (r, not verified): GitHub App user-to-server tokens with `contents:write` limited to selected repos are narrower than GitLab's `api`. GraphQL `createCommitOnBranch` creates commits marked Verified, but sources disagree on whether user-token commits are signed. https://github.blog/changelog/2021-09-13-a-simpler-api-for-authoring-commits/

### Recommendation

1. **Default: (a).** Commits use the saving user's OAuth token with scopes `read_user api`, and `author_name`/`author_email` are left out. GitLab then sets the author itself, which keeps working with web-based signing (F4). Co-editors go in as `Co-authored-by:` trailers. GitLab enforces protected branches and permissions per user.
2. Reduce the `api` blast radius on our side: encrypt tokens at rest, refresh on demand, delete tokens on logout or long inactivity. Document that self-managed admins can register a trusted instance-wide app (F9). If GitLab later extends fine-grained permissions to OAuth apps (F11), switch to repository write limited to the chosen project.
3. **Auto-commit:** use the top editor's stored refresh token (a). If none is valid, a Maintainer can configure an optional project or group access token (d), which commits as the bot with the editors in trailers. Never set `author_*` to a user with a service token (c).
4. Drop (b).

## 2. Auto-commit after everyone left

### Auto-commit after everyone left a room: options and recommendation

#### Starting point (v, code)
- `gitlab-room.ts` already auto-commits in two cases: when the room has been idle for `autoCommit` minutes, and `LEAVE_DELAY` after the last user left (`left()`).
- The commit author is whoever made the most edits (`automaticCommit` in `editors.ts`); the other editors go in as `Co-authored-by:`. Every commit uses the one server token `TYPST_GITLAB_TOKEN` and passes `author_name`/`author_email`.
- If upstream moved, the room merges it (diff3) and tries again. A conflict stops the commit and stays visible as `meta.conflict`. A failed commit stays visible as `meta.commitFailure`.
- The room's Y.Doc is stored in SQLite, so nothing is lost while it is uncommitted. Option (d) therefore already exists today.
- Once each user has an OAuth sign-in, the only open question is whose credential the server uses when nobody is connected.

#### Facts on tokens

| Claim | Source |
|---|---|
| GitLab OAuth access token: `expires_in: 7200` (2 h) | (v) https://docs.gitlab.com/api/oauth2/ |
| GitLab refresh token: using it invalidates the old access and refresh token and returns new ones (rotation) | (v) same page |
| GitLab refresh tokens never expire ("works forever"); a setting to cap the lifetime is an open feature request | (v) https://gitlab.com/gitlab-org/gitlab/-/work_items/595536 |
| The user can revoke the app under Profile → Applications → Authorized applications → Revoke; deleting the app deletes its grants and tokens | (v) https://docs.gitlab.com/integration/oauth_provider/ |
| Tokens also die when the user is blocked or deleted, or loses project access (then 403/404, not 401) | (r) |
| Two refreshes at the same time with rotation: the second one fails, so refresh must happen under one lock per user | (r) |
| Commits API: `start_branch` / `start_sha` (parent), `force` (overwrite branch), `author_name` / `author_email`; the committer is the token's user | (v) https://docs.gitlab.com/api/commits/ |
| Project access token: Maintainer/Owner creates it; self-managed any tier, GitLab.com needs Premium/Ultimate; max 365 d (400 d from 17.6); creates bot `project_<id>_bot_<rand>`, which uses no seat | (v) https://docs.gitlab.com/user/project/settings/project_access_tokens/ |
| Service accounts: Free/Premium/Ultimate; on GitLab.com only top-level group Owners create them, on self-managed admins; no seat; must be added as a project or group member; PAT max 365/400 d | (v) https://docs.gitlab.com/user/profile/service_accounts/ |
| GitHub, for later providers: App user token 8 h, refresh token 6 months, rotated on use | (v) https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens |
| GitHub App installation token: 1 h; actions are attributed to the app (bot) | (v) https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation |
| `[skip ci]` in a commit message skips the pipeline | (r) |

#### Comparison

| | (a) Last editors' stored OAuth tokens | (b) Service / bot token | (c) Side branch `typst-editor/autosave/<room>` | (d) No auto-commit; durable room + "unsaved" marker |
|---|---|---|---|---|
| Credential | Already there: the server keeps each session's access + refresh token anyway (confidential client). Store one token row per user, AES-GCM with a deployment key. Refresh under a per-user lock. | Per deployment: one service account added to every project, or `TYPST_GITLAB_TOKEN`. Per project: owner creates a project access token and pastes it in, which is extra UX. | Still the user's token (or a bot's), so it does **not** solve the credential problem | None |
| Expiry | GitLab: refresh token has no expiry, works until revoked. GitHub: 6 months. | PAT/PrAT up to 365/400 d, then someone must rotate it | as (a) or (b) | – |
| Revoked / lost access | Try the next editor by edit count; if none works, fall back to (d) and record `commitFailure` | One broken token stops auto-commit for everyone it covers | as (a) | – |
| Authorship | Real: author and committer are the editor whose token is used, the others as `Co-authored-by` | Committer is the bot. Setting `author_name` to the human is possible but **impersonation**: the user never signed this commit. | as (a) or (b) | Real, at the next manual save |
| Permissions | GitLab enforces them per user (protected branches, Developer+) | Bot needs push rights on every branch, including protected ones. Bypasses per-user rights: the bot can commit text from a user who has since lost access. | Side branch is never protected, so it usually works | – |
| Upstream conflicts | Existing merge + retry; on a conflict nothing is committed, room shows `meta.conflict`, next opener resolves | same | **None**: commit with `start_sha = meta.baseSha`, `force: true`, so the side branch is always "base + room". Save to the real branch merges as today, then deletes the side branch. | none |
| History noise | One commit per session-end on the real branch; triggers CI | same | Noise only on the side branch, but a pipeline per autosave unless `[skip ci]` (r); stale branches to clean up | none |
| Google-Docs expectation ("it's just there") | Met: the repo catches up minutes after leaving | Met | Partly: the work is in GitLab, but not on the branch people look at | Edits are durable on the server but **not in GitLab**; clones and CI see stale content until someone saves |
| New code | Small: token store + refresh lock + try editors in order (`automaticCommit` already ranks them) | Config + docs; per-project token UI if per project | New branch lifecycle, two save paths, cleanup | 0 (exists) |
| Multi-provider later | GitHub App user tokens work the same (6-month horizon) | GitHub App installation = bot | – | – |

#### Notes on how the parts fit
- Auto-commit fires at most a few minutes after the last edit (`LEAVE_DELAY`, idle timer). The last editor's access token is then usually still within its 2 h. A refresh is only needed when the server catches up later, for example after a restart or a GitLab outage.
- Sign-out: either revoke the token, so the user no longer counts for auto-commit (honest), or keep an "offline grant" only while that user has uncommitted edits in some room. Prefer revoking: simpler, and the next editor or (d) covers it.
- Order to try: editors by edit count (as `automaticCommit` does now). Use each one's own token, so author = token owner, never a different person through `author_name`. The others go in as co-authors.
- A pure 401 means refresh once and retry. 401 after refresh, 403 or 404 means skip this editor. 409/400 from upstream movement goes to the existing merge path. A conflict ends the attempt and leaves (d).
- (c) only removes conflicts and noise. Its real value would be getting conflicting work into GitLab, but SQLite durability already covers that need. It adds a second save path for little gain.

#### Recommendation
**(a) on top of (d), no (b), no (c).**
1. Keep (d) as the guaranteed baseline. It exists already: the room is durable, and the status bar shows "Not in GitLab: … (Ann, Bob)", `meta.conflict` and `meta.commitFailure`. Also show it on the welcome screen's recents entry ("unsaved changes" badge).
2. Auto-commit with the stored OAuth tokens of the room's editors, tried in edit-count order, each committing as itself. If none works (revoked, no access, protected branch, conflict), fall back to (d) silently, with the reason in `commitFailure`.
3. Drop the server-wide `TYPST_GITLAB_TOKEN` for commits. That removes the impersonation and permission bypass. Keep a token or webhook secret only for webhooks, if needed.
4. Revisit (b), as a per-deployment service account, only if a customer requires commits independent of user grants, and then with bot authorship, not impersonation.

This matches the Google Docs expectation: nothing is lost, and the repo catches up shortly after people leave. It uses only credentials the confidential-client design already holds.

## 3. Several git hosting providers

Recommendation: stay GitLab-only for now, but build in the seams listed in section 5. They cost about 100 lines today and make adding a second provider an add-on rather than a refactor. Each further provider is then roughly 0.9 to 1.6k lines with a fake and tests, which is 2 to 4 days of agent work. I edited and committed nothing.

### 1. Each part of the GitLab concept on other hosts

| Part | GitLab (today / concept) | GitHub | Gitea / Forgejo | Bitbucket Cloud |
|---|---|---|---|---|
| OAuth | Confidential client; token lasts 2 h; the refresh token is replaced on every use (v) [1]. PKCE recommended (v) [1] | **OAuth app**: the `repo` scope is "full access to public and private repositories" (v) [2], tokens don't expire (r). **GitHub App**: user tokens last 8 h, refresh tokens 6 months (v) [3]. Access is limited to what the app may do, what the user may do, and the accounts where the app is installed (v) [4]. Installing needs an org owner or admin to approve (v) [5] | OAuth2 provider (r) | OAuth 2.0 consumers, tokens last 2 h (r) |
| Committing when nobody is online (auto-commit) | Use the stored refresh token of the user who edited most (concept) | OAuth app: the stored token is enough (r). GitHub App: a refresh token, or an **installation token** (1 h, created from the app's private key at any time) (v) [6]. Commits then show the bot as author (r) | Stored token (r) | Refresh token (r) |
| List repositories / branches | `/projects?membership&search`, `/branches?search` | `/user/repos`; with a GitHub App only the installed repositories (r) | `/user/repos`, `/repos/search` (r) | `/repositories?role=member`, `/refs/branches` (r) |
| Access check | `permissions.access_level` | `permissions.push` on the repository (r) | `permissions.push` (r) | `/user/permissions/repositories` (r) |
| Tree / blobs | Paged recursive tree, `files/:path`, `blobs/:sha/raw` (v, code) | `git/trees/:sha?recursive=1`: at most 100,000 entries and 7 MB, otherwise truncated (v) [7]. `git/blobs/:sha` (r) | `git/trees` (paged), `git/blobs` (r) | `src/{commit}/{path}` directory listings, no recursive tree (r) |
| Multi-file commit | `POST /repository/commits` with actions. Each action can carry `last_commit_id` (a check per file). `start_sha` and `force` exist (v) [8]. I found no way to require "the branch is still at X" on an existing branch (r) | **GraphQL `createCommitOnBranch`**: `expectedHeadOid`, additions/deletions, no renames, commit signed by GitHub (v) [9]. Or the REST Git Data API: blobs → tree with `base_tree` (`sha:null` deletes) (v) [7] → commit → move the ref without force, which only fast-forwards (r). That is 4 or more calls | `POST /repos/{o}/{r}/contents`: `files[]` with `operation` create/update/delete, `sha` (required for update/delete), `from_path` for moves, content base64, `author`, `committer`, `branch` (v) [10]. Forgejo: same API (r) | `POST /2.0/repositories/{ws}/{repo}/src`, multipart form, field name = path, `files` lists deletions (v, search snippet) [11]. A `parents` parameter (r) |
| Conflict detection | Per file (`last_commit_id`) | Whole branch (`expectedHeadOid` / fast-forward only) | Per file (`sha`) | Through parents (r) |
| Webhooks | `X-Gitlab-Token` holds a shared secret (v, code) | GitHub App: one central webhook for all repositories where it is installed. OAuth app: one hook per repository, which needs admin (v) [5]. Signed with `X-Hub-Signature-256` HMAC (r) | `X-Gitea-Signature` HMAC (r) | Webhook secret, HMAC (r) |
| Paste a URL to open it | `/-/tree/<ref>/<path>`, `/-/blob/`, merge requests | `/tree/<ref>/<path>`, `/blob/`, `/pull/N` (same branch-with-`/` ambiguity) (r) | `/src/branch/<ref>/<path>` (r) | `/src/<ref>/<path>` (r) |
| Rate limits | gitlab.com: per user, configurable when self-hosted (r) | REST 5,000 requests per hour per user. Installations at least 5,000, up to 12,500, 15,000 on Enterprise Cloud (v) [12]. Git transfers don't count against REST limits (r) | Self-hosted, configurable (r) | 1,000 per hour per user for some endpoints (r) |

### 2. Option: plain git (go-git) as the only read and write path

| + | − |
|---|---|
| One implementation of Head, Tree, Blob and Commit for every host. Providers keep only OAuth, listing, URL parsing, the access check and webhooks | A cached bare repository on disk per (provider, repository), fetched on load and on webhook |
| Real compare-and-swap: a push that isn't a fast-forward is refused, the same on every host | Without a partial clone, large binary assets are downloaded. `blob:none` needs **go-git v6, still only `v6.0.0-beta.1` (2026-10-04)** (v) [13]. v5 has no partial clone (r) |
| Narrower GitLab scope: OAuth tokens with `write_repository` work over HTTPS as user `oauth2` (v) [1]. The Commits API needs `api` (r) | Commits are not GitHub-signed ("Verified" comes only from the API path (v) [9]) |
| Git transfers fall outside the REST rate limits (r). Also works with any self-hosted git server | go-git is the second young dependency next to ygo. Its push and auth behaviour must be checked per host. GitHub installation tokens use user `x-access-token` (v) [6] |

Verdict: it is a good fit as a later "generic git" provider, or as the second implementation of `Repository`. It should not be the only path now, because of the v6 beta and the disk cache. The `Repository` interface below allows either one.

### 3. Proposed interface (Go)

```go
type Provider interface {             // one per configured instance ("gitlab", "github", "codeberg")
    ID() string
    OAuth() *oauth2.Config            // x/oauth2 has endpoints for GitHub, GitLab, Bitbucket (r)
    Me(ctx, *oauth2.Token) (Identity, error)                 // stable numeric user id, name, email
    Repos(ctx, tok, query string, page string) ([]RepoInfo, string, error)
    Branches(ctx, tok, repo, query string) ([]string, error)
    Access(ctx, tok, repo string) (Access, error)            // None/Read/Write
    Resolve(ctx, tok, url string) (Location, error)          // pasted URL → repo, branch, folder, file
    Repository(tok TokenSource, repo string) Repository
    Webhook(*http.Request) ([]Push, error)                   // verify signature, return (repo, branch) pairs
}
type Repository interface {           // = today's GitLabProject
    Head(ctx, branch) (sha string, err error)
    Tree(ctx, sha) ([]TreeEntry, error)
    Blob(ctx, sha) ([]byte, error)
    Commit(ctx, CommitRequest{Branch, ExpectedHead, Message, Author, Changes}) (Commit, error) // ErrConflict
}
```

**Change needed before Go, to keep providers simple:** today's room calls `file()` once per `.typ` file only to get `last_commit_id` (`gitlab-room.ts:311`, `lastCommits` in meta). That is GitLab-specific and costs N calls. Make conflicts a branch-level check instead (`ExpectedHead`, then on `ErrConflict` do the existing 3-way merge and retry). That removes `lastCommits` from `RoomMeta`.

For GitLab, `ExpectedHead` would be emulated as Head, compare, then commit. That leaves a small race window, unless `last_commit_id` keeps doing a per-file check inside the GitLab implementation. GitLab probably compares `last_commit_id` exactly with the file's last commit, so the base commit cannot simply be passed (r: check before relying on it).

### 4. Effort per provider (estimates, Go)

| Piece | GitLab (first) | + GitHub (OAuth app) | + GitHub App instead | + Gitea/Forgejo | + Bitbucket |
|---|---|---|---|---|---|
| OAuth + Me | 60 | 40 | +150 (installation flow, JWT, installation tokens, "install the app" UX) | 40 | 50 |
| Repos, Branches, Access | 150 | 150 | 180 | 130 | 150 |
| Repository (Head, Tree, Blob, Commit) | 200 | 250 (GraphQL commit + REST tree) | same | 180 | 300 (multipart, no recursive tree) |
| Resolve (URL) | 100 | 100 | same | 80 | 80 |
| Webhook | 50 | 60 | 40 (central) | 50 | 60 |
| Fake for tests | 300 (exists in TS) | 300 | +100 | 250 | 300 |
| **Total** | ~850 | ~900 → **2–3 days** | ~1,300 → **3–4 days** | ~750 → **2 days** | ~950 → **3 days** |
| Shared, once: registry, provider-aware URLs and recents, sign-in to a second provider | — | ~300, 1 day | | | |

The room, merge, commit-action and session layers stay provider-independent. A shared conformance test suite (one set of tests run against every fake) is about 300 lines once.

### 5. Decide now (cheap), build later

| Seam | Decide now |
|---|---|
| Room name | `<provider id>:<repo path>@<branch>:<folder>` with each part `encodeURIComponent`-ed. Provider id = configured instance id (`gitlab`, `gitlab-intern`, `github`), not the provider type |
| Project URL | `/<path>/-/tree/<branch>/<folder>` for the default provider; `/~<provider id>/<path>/-/tree/…` for others. Pasting a URL means matching its host against the configured providers |
| Identity | Users table keyed by `(provider id, provider user id)`, never by email or name. No merging of accounts across providers (later at most a "linked accounts" table). One session can hold tokens for several providers (`session_grants(session, provider, token…)`) |
| Recents | Keyed by `(provider id, provider user id)`; each entry stores the provider id + repository id + branch + folder + main file |
| Config | `providers: [{id, type: gitlab, url, client_id, …}]`, `default_provider: gitlab` (koanf). Ship with one entry |
| Code | Write `server/lib/gitlab` against the `Repository` interface above (a Go version of today's `GitLabProject`). Make conflicts branch-level. Webhook route `/hooks/<provider id>`. Commit author comes from `Identity` |
| Not now | Provider registry beyond a map, GitHub App installation flow, go-git path, Bitbucket |

### 6. Recommendation

**GitLab-only, with the seams in section 5.** The seams cost about 100 lines now: the provider id in room names, URLs, identity, recents and config, plus `Repository` as an interface and branch-level conflict detection. Leave out the abstract `Provider` and OAuth registry until a second provider is actually requested. With one implementation it would only be guesswork.

When GitHub comes:
- **GitHub App vs OAuth app:** the GitHub App gets central webhooks, fine-grained access and installation tokens for auto-commit, but needs org approval. The OAuth app is simpler but needs the broad `repo` scope and webhooks set up per repository.
- **go-git:** possibly as a generic fallback provider once v6 is stable.

Sources:
[1] https://docs.gitlab.com/api/oauth2/
[2] https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
[3] https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
[4] https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user
[5] https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps
[6] https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation
[7] https://docs.github.com/en/rest/git/trees
[8] https://docs.gitlab.com/api/commits/
[9] https://docs.github.com/en/graphql/reference/commits (createCommitOnBranch; details from search snippets, the page itself wasn't parsed)
[10] https://docs.gitea.com/api/1.24/operations/repo-change-files/
[11] https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/ (page truncated; claims from search snippets)
[12] https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
[13] https://github.com/go-git/go-git/releases

Files read: `/Users/sebastian/src/typst-experiment/docs/2026_10_13_gitlab-projects.md`, `/Users/sebastian/src/typst-experiment/docs/2026_10_13_go-server.md`, `/Users/sebastian/src/typst-experiment/server/src/gitlab/gitlab-api.ts`, `/Users/sebastian/src/typst-experiment/server/src/gitlab/commit-actions.ts`, `/Users/sebastian/src/typst-experiment/server/src/gitlab/gitlab-room.ts`, `/Users/sebastian/src/typst-experiment/server/src/gitlab/http-endpoints.ts`
