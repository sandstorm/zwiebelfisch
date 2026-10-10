import type { Browser, Page } from '@playwright/test';
import { expect, serve, test } from './fixtures';

// Two users in one room of the local collaboration server. Needs the server:
// run through `mise run test:e2e-collab`, which starts it (ws://127.0.0.1:1234).
test.skip(!process.env.TYPST_COLLAB_E2E, 'needs the collaboration server: mise run test:e2e-collab');

async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${room}&user=${user}`);
  await expect(page.getByTestId('typst-visual')).toContainText('Hello Typst');
  return page;
}

async function users(browser: Browser, baseURL: string, project: string) {
  const room = `e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ann = await join(browser, baseURL, room, 'Ann');
  const bob = await join(browser, baseURL, room, 'Bob');
  return { ann, bob };
}

test('an edit in one Source view shows up in the other user’s Visual and Source views', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: 'This is' }).click();
  await ann.keyboard.press('Home');
  await ann.keyboard.type('Together: ');
  await expect(bob.getByTestId('typst-visual')).toContainText('Together: This is');
  await bob.getByRole('tab', { name: 'Source' }).click();
  await expect(bob.getByTestId('typst-source')).toContainText('Together: This is');
});

test('edits from both Visual views converge', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('h1').click();
  await ann.keyboard.press('End');
  await ann.keyboard.type(' (Ann)');
  await bob.getByTestId('typst-visual').locator('li', { hasText: 'second item' }).click();
  await bob.keyboard.press('End');
  await bob.keyboard.type(' (Bob)');
  for (const page of [ann, bob]) {
    await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst (Ann)');
    await expect(page.getByTestId('typst-visual').locator('li', { hasText: 'second item' })).toHaveText('second item (Bob)');
  }
});

test('the other user’s selection is shown with their name', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'bold' }).dblclick();
  const selection = bob.getByTestId('typst-visual').locator('.typst-remote-selection');
  await expect(selection).toHaveText('bold');
  await expect(selection.first()).toHaveAttribute('data-user', 'Ann');
});

test('a review comment reaches the other user', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'bold' }).dblclick();
  await ann.locator('.typst-editor__comment').click();
  await ann.getByTestId('typst-comments').getByRole('textbox', { name: 'Add a comment' }).fill('Shared note');
  await ann.getByTestId('typst-comments').getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(bob.getByTestId('typst-comments')).toContainText('Shared note');
  await expect(bob.getByTestId('typst-visual').locator('.typst-comment-range')).toHaveText('bold');
});
