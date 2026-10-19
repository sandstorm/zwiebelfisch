// Playwright for docs-editing.spec.ts (`mise run test:e2e-docs`): against the Vite dev server (a running `mise run
// demo` is used as it is), whose docs-files plugin saves to docs/. One worker: every browser edits the same file.
// See playwright.config.ts.
import { serverSuite } from './playwright.config';

export default serverSuite('docs', {
  workers: 1,
  webServer: {
    command: 'pnpm exec vite',
    port: 5199,
    reuseExistingServer: true,
  },
});
