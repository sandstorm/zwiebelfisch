// Collaboration server for the demo playground (`mise run demo`, also
// `mise run server:dev-fake-gitlab`, `mise run test:e2e-gitlab` and the Docker
// image): plain rooms as usual, and GitLab rooms backed by an in-memory fake
// GitLab whose project `demo/report` holds the demo's advanced example
// (template, chapters, images). No real GitLab, no secrets, nothing stored.
// Any branch works: gitlab:demo/report@<branch> starts at main.
//   PORT (default 1234)
//   HOST (default 127.0.0.1) the address to listen on (the Docker image: 0.0.0.0)
//   TYPST_GITLAB_AUTO_COMMIT (default 10) minutes without edits before a room commits by itself; `off`: never
//   TYPST_DEMO_DIST (default unset) a built demo (dist/demo) to serve on DEMO_PORT (default 5199), where Vite
//                   would serve it (see playground/static-files.ts)
// See docs/30_architecture/11_development.typ.
import { createServer } from 'node:http';
import { createCollabServer } from './collab-server.ts';
import { parseAutoCommit } from './gitlab/gitlab-extension.ts';
import { FakeGitLab } from './gitlab/fake-gitlab.ts';
import { PLAYGROUND_PROJECT, playgroundOptions } from './playground/playground.ts';
import { readProjectFiles } from './playground/project-files.ts';
import { staticFiles } from './playground/static-files.ts';

const gitlab = new FakeGitLab(PLAYGROUND_PROJECT, readProjectFiles(new URL('../../demo/examples/advanced/', import.meta.url)));
gitlab.autoBranches = true;

const host = process.env.HOST ?? '127.0.0.1';
const server = createCollabServer({
  port: Number(process.env.PORT ?? 1234),
  address: host,
  ...playgroundOptions(gitlab, { appendTo: '/chapters/introduction.typ', autoCommit: parseAutoCommit(process.env.TYPST_GITLAB_AUTO_COMMIT) }),
});
// stops on SIGINT and SIGTERM (Hocuspocus exits the process), the demo's server with it
await server.listen();

const dist = process.env.TYPST_DEMO_DIST;
if (dist) {
  const serve = staticFiles(dist);
  const port = Number(process.env.DEMO_PORT ?? 5199);
  createServer((request, response) => void serve(request, response)).listen(port, host, () => {
    // the page expects the server on 127.0.0.1 (demo/playground.ts), so that is the address to open
    console.log(`Demo on http://127.0.0.1:${port}/ (${dist})`);
  });
}
