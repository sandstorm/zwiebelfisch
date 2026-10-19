// Playwright for collab.spec.ts (`mise run test:e2e-collab`): two users in one room of the playground server
// (server/cmd/fake-gitlab, plain rooms on), which also serves the demo build on :5199, same host as the server, so the
// session cookie goes along. Its fake GitLab signs the users in (zwiebelfisch needs a real provider). See playwright.config.ts.
import { serverSuite } from './playwright.config';

export default serverSuite('collab', {
  webServer: {
    command: '.cache/bin/fake-gitlab',
    env: { ZWF_PLAIN_ROOMS: '1', ZWF_DEMO_DIST: 'dist/demo' },
    port: 1234,
  },
});
