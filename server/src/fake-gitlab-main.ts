// Collaboration server with GitLab rooms backed by an in-memory fake GitLab:
// `mise run server:dev-fake-gitlab` (and `mise run test:e2e-gitlab`). Try it
// with the demo: http://127.0.0.1:5199/?room=gitlab:demo/report@main
//   PORT (default 1234)
import { createCollabServer } from './collab-server.ts';
import { FakeGitLab } from './gitlab/fake-gitlab.ts';

const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#239dad"/></svg>`;

const gitlab = new FakeGitLab('demo/report', {
  '/main.typ': `#set page(width: 16cm, height: auto, margin: 1.5cm)

= Hello GitLab

This report lives in a (fake) GitLab repository.

#image("logo.svg", width: 1cm)

#include "chapter.typ"
`,
  '/chapter.typ': '== A chapter\n\nText of the chapter.\n',
  '/logo.svg': LOGO,
});
gitlab.autoBranches = true;

const server = createCollabServer({
  port: Number(process.env.PORT ?? 1234),
  gitlab: { url: gitlab.url, token: gitlab.token, fetch: gitlab.fetch },
});
await server.listen();
