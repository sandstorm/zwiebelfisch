import { defineConfig, devices } from '@playwright/test';

// Tests run against the static demo build (see tests/e2e/fixtures.ts), which is
// served through request interception, so no dev server or open port is needed.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: { baseURL: 'http://zwiebelfisch.test', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
