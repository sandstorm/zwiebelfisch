// Playwright for gitlab.spec.ts and guest.spec.ts (`mise run test:e2e-gitlab`): GitLab rooms (and guest links) on the playground server
// (server/cmd/fake-gitlab), which also serves the demo build on :5199: the specs open it there, same host as the
// server, so the session cookie goes along, and the browser comes back there from signing in. Plain rooms stay off
// (the default): the spec checks that such a server refuses them. See playwright.config.ts.
import { serverSuite } from './playwright.config';

export default serverSuite('gitlab', {
  webServer: {
    command: '.cache/bin/fake-gitlab',
    env: { ZWF_DEMO_DIST: 'dist/demo', ZWF_GUESTS: '1' },
    port: 1234,
  },
});
