// End-to-end tests (Playwright, against the demo build): the demo playground's modes and bar.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// The demo's playground bar without a server: Local mode (the default) never
// talks to one; the room modes are checked against an unreachable server and a
// stubbed playground endpoint (WebSockets are not stubbed: the widget keeps
// waiting for its room there, which these tests do not need). The real
// server is covered by collab.spec.ts and gitlab.spec.ts.

const SERVER = 'http://127.0.0.1:1234';
const GITLAB_ROOM = 'gitlab:demo/report@main';
const bar = (page: Page) => page.locator('#playground');
const status = (page: Page) => bar(page).getByRole('status');
const modes = (page: Page) => bar(page).getByRole('navigation', { name: 'Mode' });

/** Nothing listens on the server's port. */
async function noServer(page: Page): Promise<void> {
  await page.route(`${SERVER}/**`, (route) => route.abort('connectionrefused'));
}

test('Local mode is the default and needs no server', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(modes(page).getByRole('link', { name: 'Local' })).toHaveAttribute('aria-current', 'page');
  await expect(status(page)).toContainText('no server needed');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  await expect(bar(page).getByRole('button', { name: 'Simulate upstream commit' })).toHaveCount(0);
  await expect(bar(page).getByTestId('second-window')).toHaveCount(0);
  expect(requests.filter((url) => url.startsWith(SERVER))).toEqual([]);
});

test('the mode links keep the example and join the matching room', async ({ page }) => {
  await page.goto('/?example=simple');
  const href = async (name: string) => new URL((await modes(page).getByRole('link', { name }).getAttribute('href'))!, 'http://x').searchParams;
  expect((await href('Collaborate')).get('room')).toBe('playground-simple');
  expect((await href('Collaborate')).get('example')).toBe('simple');
  expect((await href('GitLab (fake)')).get('room')).toBe(GITLAB_ROOM);
});

test('the name field reloads as that user', async ({ page }) => {
  await page.goto('/?example=simple');
  const name = bar(page).getByRole('textbox', { name: 'Your name' });
  await expect(name).toHaveValue('Demo user');
  await name.fill('Ada');
  await name.press('Enter');
  await expect(page).toHaveURL(/[?&]user=Ada(&|$)/);
  await expect(bar(page).getByRole('textbox', { name: 'Your name' })).toHaveValue('Ada');
});

test('Collaborate without a server: says how to start it and edits a local copy', async ({ page }) => {
  await noServer(page);
  await page.goto('/?room=playground-hello');
  await expect(page).toHaveURL(/user=Ann/);
  await expect(status(page)).toContainText('not reachable');
  await expect(status(page).locator('code')).toHaveText('mise run demo');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  const second = bar(page).getByTestId('second-window');
  await expect(second).toHaveText('Open a second window as Bob');
  await expect(second).toHaveAttribute('href', /room=playground-hello/);
  await expect(second).toHaveAttribute('href', /user=Bob/);
});

test('GitLab mode: examples are fixed, the upstream simulation calls the playground endpoint', async ({ page }) => {
  const posted: string[] = [];
  await page.route(`${SERVER}/playground`, (route) =>
    route.fulfill({ json: { project: 'demo/report', room: GITLAB_ROOM }, headers: { 'Access-Control-Allow-Origin': '*' } }),
  );
  await page.route(/:1234\/playground\/upstream\?/, (route) => {
    posted.push(route.request().url());
    return route.fulfill({
      json: { sha: '0123456789abcdef', path: '/chapters/introduction.typ', message: 'Add a paragraph (simulated upstream commit 1)' },
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await page.goto(`/?room=${encodeURIComponent(GITLAB_ROOM)}&user=Ann`);
  await expect(modes(page).getByRole('link', { name: 'GitLab (fake)' })).toHaveAttribute('aria-current', 'page');
  await expect(bar(page).getByRole('navigation', { name: 'Examples' }).getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-disabled', 'true');
  await expect(status(page)).toContainText('fake GitLab');

  await bar(page).getByRole('combobox', { name: 'Upstream change' }).selectOption('heading');
  await bar(page).getByRole('button', { name: 'Simulate upstream commit' }).click();
  await expect(status(page)).toContainText('GitLab: 01234567 “Add a paragraph (simulated upstream commit 1)”');
  expect(new URL(posted[0]).searchParams.get('change')).toBe('heading');
  expect(new URL(posted[0]).searchParams.get('room')).toBe(GITLAB_ROOM);
});

test('the playground bar toggles the devtools, keeping the rest of the URL', async ({ page }) => {
  await page.goto('/?example=simple#/main.typ');
  await expect(page.getByTestId('typst-panel-toggle-devtools')).toHaveCount(0);
  const toggle = bar(page).getByRole('checkbox', { name: 'Devtools' });
  await expect(toggle).not.toBeChecked();
  // a click, not check(): the page reloads
  await toggle.click();
  await expect(page).toHaveURL(/\?example=simple&devtools#\/main\.typ$/);
  await expect(page.getByTestId('typst-panel-toggle-devtools')).toBeVisible();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(page).toHaveURL(/\?example=simple#\/main\.typ$/);
  await expect(page.getByTestId('typst-panel-toggle-devtools')).toHaveCount(0);
});
