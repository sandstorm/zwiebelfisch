import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/** The specs that need a server of their own: each runs with its config, which starts that server. */
const SERVER_SPECS = { collab: 'collab.spec.ts', gitlab: 'gitlab.spec.ts', docs: 'docs-editing.spec.ts' };

/** What every e2e suite shares: the specs in tests/e2e, timeouts, traces, the three browsers. */
const suite = {
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: { baseURL: 'http://zwiebelfisch.test', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
} satisfies PlaywrightTestConfig;

/** The config of the suite `name` (one of SERVER_SPECS): its spec only, its results in test-results/<name>/. */
export function serverSuite(name: keyof typeof SERVER_SPECS, config: PlaywrightTestConfig): PlaywrightTestConfig {
  return defineConfig({ ...suite, testMatch: SERVER_SPECS[name], outputDir: `test-results/${name}`, ...config });
}

// Tests run against the static demo build (see tests/e2e/fixtures.ts), which is
// served through request interception, so no dev server or open port is needed.
export default defineConfig({ ...suite, testIgnore: Object.values(SERVER_SPECS), outputDir: 'test-results/e2e' });
