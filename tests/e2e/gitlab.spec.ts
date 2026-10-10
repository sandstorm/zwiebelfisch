import type { Browser, Page } from '@playwright/test';
import { expect, serve, test } from './fixtures';

// A room backed by a (fake, in-memory) GitLab branch. Needs the server with
// the fake GitLab: run through `mise run test:e2e-gitlab`, which starts it
// (ws://127.0.0.1:1234; every test gets a fresh branch of demo/report).
test.skip(!process.env.TYPST_GITLAB_E2E, 'needs the collaboration server with a fake GitLab: mise run test:e2e-gitlab');

async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${encodeURIComponent(room)}&user=${user}`);
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello GitLab');
  return page;
}

async function users(browser: Browser, baseURL: string, project: string) {
  const room = `gitlab:demo/report@e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { ann: await join(browser, baseURL, room, 'Ann'), bob: await join(browser, baseURL, room, 'Bob') };
}

async function saveVersion(page: Page, message: string): Promise<void> {
  await page.getByRole('button', { name: 'Save version' }).click();
  const form = page.getByRole('form', { name: 'Save version' });
  await form.getByRole('textbox', { name: 'Commit message' }).fill(message);
  await form.getByRole('button', { name: 'Apply' }).click();
}

test('the branch is loaded with its files, images from the repository', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await expect(ann.getByTestId('typst-files')).toContainText('chapter.typ');
  await expect(ann.getByTestId('typst-files')).toContainText('logo.svg');
  await expect(ann.locator('.typst-editor__right svg image, .typst-editor__right svg use').first()).toBeAttached();
});

test('Save version commits; everyone’s "Show changes" starts over from the new version', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('h1').click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' again');
  await expect(bob.getByTestId('typst-visual').locator('.typst-diff-insert')).toHaveText(' again');

  await saveVersion(ann, 'Greet again');
  await expect(ann.locator('.typst-editor__version-status')).toContainText('Saved version');
  await expect(bob.locator('.typst-editor__version-status')).toContainText('Saved version');
  await expect(bob.getByTestId('typst-visual').locator('.typst-diff-insert')).toHaveCount(0);
  await expect(bob.getByTestId('typst-visual').locator('h1')).toHaveText('Hello GitLab again');
});

test('saving without changes says so', async ({ browser, baseURL }, info) => {
  const { ann } = await users(browser, baseURL!, info.project.name);
  await saveVersion(ann, 'Nothing');
  await expect(ann.locator('.typst-editor__version-status')).toHaveText('No changes to save');
});
