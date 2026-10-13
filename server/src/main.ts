// Development collaboration server: `mise run server:dev`. See docs/40_architecture/09_server.typ.
//   PORT                (default 1234)       the demo connects to ws://127.0.0.1:1234 with ?room=<name>
//   TYPST_COLLAB_DB     (default server/.data/collab.sqlite)
//   TYPST_COLLAB_TOKEN  (default unset: no check) the token clients must send
// GitLab-backed rooms (`gitlab:<project id or path>@<branch>`), enabled when both are set:
//   TYPST_GITLAB_URL            e.g. https://gitlab.com
//   TYPST_GITLAB_TOKEN          a token with `api` scope (secret: keep it in mise.local.toml or .env, never commit it)
//   TYPST_GITLAB_WEBHOOK_SECRET (optional) enables POST /gitlab/webhook for push events
//   TYPST_GITLAB_AUTHOR_EMAIL   (optional) commit author email when the user's is unknown
//   TYPST_GITLAB_AUTO_COMMIT    (default 10) minutes without edits before a room commits by itself
//                               (also 20 s after the last user left); `off`: only "Save to GitLab…"
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sharedToken } from './auth.ts';
import { createCollabServer } from './collab-server.ts';
import { parseAutoCommit, type GitLabOptions } from './gitlab/gitlab-extension.ts';

const database = process.env.TYPST_COLLAB_DB ?? 'server/.data/collab.sqlite';
mkdirSync(dirname(database), { recursive: true });

function gitlab(env: NodeJS.ProcessEnv): GitLabOptions | undefined {
  if (!env.TYPST_GITLAB_URL || !env.TYPST_GITLAB_TOKEN) return undefined;
  return {
    url: env.TYPST_GITLAB_URL,
    token: env.TYPST_GITLAB_TOKEN,
    webhookSecret: env.TYPST_GITLAB_WEBHOOK_SECRET || undefined,
    authorEmail: env.TYPST_GITLAB_AUTHOR_EMAIL || undefined,
    autoCommit: parseAutoCommit(env.TYPST_GITLAB_AUTO_COMMIT),
  };
}

const server = createCollabServer({
  port: Number(process.env.PORT ?? 1234),
  database,
  authenticate: sharedToken(process.env.TYPST_COLLAB_TOKEN),
  gitlab: gitlab(process.env),
});
await server.listen();
