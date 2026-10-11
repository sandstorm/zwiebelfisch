// Collaboration server for the demo playground (`mise run demo`, also
// `mise run server:dev-fake-gitlab` and `mise run test:e2e-gitlab`): plain
// rooms as usual, and GitLab rooms backed by an in-memory fake GitLab whose
// project `demo/report` holds the demo's advanced example (template, chapters,
// images). No real GitLab, no secrets, nothing stored. Any branch works:
// gitlab:demo/report@<branch> starts at main.
//   PORT (default 1234)
//   TYPST_GITLAB_AUTO_COMMIT (default 10) minutes without edits before a room commits by itself; `off`: never
// See docs/30_architecture/11_development.typ.
import { createCollabServer } from './collab-server.ts';
import { parseAutoCommit } from './gitlab/gitlab-extension.ts';
import { FakeGitLab } from './gitlab/fake-gitlab.ts';
import { PLAYGROUND_PROJECT, playgroundOptions } from './playground/playground.ts';
import { readProjectFiles } from './playground/project-files.ts';

const gitlab = new FakeGitLab(PLAYGROUND_PROJECT, readProjectFiles(new URL('../../demo/examples/advanced/', import.meta.url)));
gitlab.autoBranches = true;

const server = createCollabServer({
  port: Number(process.env.PORT ?? 1234),
  ...playgroundOptions(gitlab, { appendTo: '/chapters/introduction.typ', autoCommit: parseAutoCommit(process.env.TYPST_GITLAB_AUTO_COMMIT) }),
});
await server.listen();
