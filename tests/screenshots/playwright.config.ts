// Playwright for the docs' pictures (features.spec.ts), apart from the e2e suites' config so `test:e2e` never runs
// them: Chromium only, against the demo build as the e2e tests (tests/e2e/fixtures.ts). See features.spec.ts.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/screenshots',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: { ...devices['Desktop Chrome'], baseURL: 'http://typst-editor.test', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium' }],
});
