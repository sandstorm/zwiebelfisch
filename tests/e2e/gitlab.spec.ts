// End-to-end tests (Playwright, against the demo build): GitLab-backed rooms (needs the fake GitLab server: mise run test:e2e-gitlab).
import type { Browser, Page } from '@playwright/test';
import { expect, fileRow, openFile, serve, test } from './fixtures';

// A room backed by a (fake, in-memory) GitLab branch. Needs the server with
// the fake GitLab: run through `mise run test:e2e-gitlab`, which starts it
// (ws://127.0.0.1:1234; every test gets a fresh branch of demo/report, which
// holds the demo's advanced example: template, chapters, SVG images).
test.skip(!process.env.TYPST_GITLAB_E2E, 'needs the collaboration server with a fake GitLab: mise run test:e2e-gitlab');

const SERVER = 'http://127.0.0.1:1234';

/** Opens the room as `user` (main.typ shown). */
async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${encodeURIComponent(room)}&user=${user}`);
  await expect(fileRow(page, 'chapters')).toBeVisible();
  return page;
}

/** Text in the Visual view of the file shown (each opened file keeps a hidden Visual view of its own). */
const visualText = (page: Page, text: string) => page.getByTestId('typst-visual').getByText(text);

async function users(browser: Browser, baseURL: string, project: string) {
  const room = `gitlab:demo/report@e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { room, ann: await join(browser, baseURL, room, 'Ann'), bob: await join(browser, baseURL, room, 'Bob') };
}

async function saveVersion(page: Page, message: string): Promise<void> {
  await page.getByRole('button', { name: 'Save version' }).click();
  const form = page.getByRole('form', { name: 'Save version' });
  await form.getByRole('textbox', { name: 'Commit message' }).fill(message);
  await form.getByRole('button', { name: 'Apply' }).click();
}

test('the branch is loaded with its files, images from the repository', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await expect(fileRow(ann, 'template.typ')).toBeVisible();
  await fileRow(ann, 'assets').click();
  await expect(fileRow(ann, 'assets/compile-times.svg')).toBeVisible();
  await expect(ann.locator('.typst-editor__right svg image, .typst-editor__right svg use').first()).toBeAttached();
});

test('Save version commits; everyone’s "Show changes" starts over from the new version', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  // "Show changes" covers the main file; its Visual view is all raw boxes, so Ann types in Source
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: '#pagebreak()' }).click();
  await ann.keyboard.press('End');
  await ann.keyboard.press('Enter');
  await ann.keyboard.press('Enter');
  await ann.keyboard.type('Again.');
  await expect(bob.getByTestId('typst-visual').locator('.typst-diff-insert')).toContainText('Again');

  await saveVersion(ann, 'Add a line');
  await expect(ann.locator('.typst-editor__version-status')).toContainText('Saved version');
  await expect(bob.locator('.typst-editor__version-status')).toContainText('Saved version');
  await expect(bob.getByTestId('typst-visual').locator('.typst-diff-insert')).toHaveCount(0);
  await expect(visualText(bob, 'Again.')).toBeVisible();
});

test('a simulated upstream commit (playground endpoint) is merged into the room', async ({ browser, baseURL, request }, info) => {
  const { room, ann, bob } = await users(browser, baseURL!, info.project.name);
  const response = await request.post(`${SERVER}/playground/upstream?room=${encodeURIComponent(room)}`);
  expect(response.ok()).toBe(true);
  for (const page of [ann, bob]) {
    await expect(page.locator('.typst-editor__version-status')).toHaveText('Merged new changes from GitLab');
    await openFile(page, 'chapters/introduction.typ');
    await expect(visualText(page, 'a colleague added this paragraph on GitLab')).toBeVisible();
  }
});

test('saving without changes says so', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await saveVersion(ann, 'Nothing');
  await expect(ann.locator('.typst-editor__version-status')).toHaveText('No changes to save');
});
