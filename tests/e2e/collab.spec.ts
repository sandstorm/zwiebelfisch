// End-to-end tests (Playwright, against the demo build): two users in one room (needs the collaboration server: mise run test:e2e-collab).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

test('the other user’s caret shows with their name in both views, where they moved it last', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('h1').click();
  await ann.keyboard.press('End');
  const visualCaret = bob.getByTestId('typst-visual').locator('h1 .typst-remote-caret[data-user="Ann"]');
  await expect(visualCaret).toHaveCount(1);
  await expect(visualCaret.locator('.typst-remote-caret__flag')).toBeVisible();
  await expect(visualCaret.locator('.typst-remote-caret__flag')).toHaveText('Ann');
  // Regression: the caret is published after the move, not one step behind (at the click position).
  const textBefore = () =>
    visualCaret.evaluate((caret) => {
      const range = document.createRange();
      range.setStart(caret.closest('h1')!, 0);
      range.setEndBefore(caret);
      return range.toString();
    });
  await expect.poll(textBefore).toBe('Hello Typst');
  await ann.keyboard.press('Home');
  await expect.poll(textBefore).toBe('');
  await expect(bob.getByTestId('typst-preview').locator('.typst-preview__presence')).toHaveCount(0);
  await bob.getByRole('tab', { name: 'Source' }).click();
  const line = bob.getByTestId('typst-source').locator('.cm-line', { hasText: 'Hello Typst' });
  const sourceCaret = line.locator('.typst-remote-caret[data-user="Ann"]');
  await expect(sourceCaret).toHaveCount(1);
  await sourceCaret.hover({ force: true });
  await expect(sourceCaret.locator('.typst-remote-caret__flag')).toHaveCSS('opacity', '1');
});

test('a caret on an empty line shows in the other user’s Source view', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: /^$/ }).first().click();
  await bob.getByRole('tab', { name: 'Source' }).click();
  const caret = bob.getByTestId('typst-source').locator('.typst-remote-caret[data-user="Ann"]');
  await expect(bob.getByTestId('typst-source').locator('.cm-line', { has: caret })).toHaveText('Ann');
});

test('a margin note reaches the other user', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'bold' }).dblclick();
  await ann.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' }).click();
  const field = ann.getByTestId('typst-note-card').getByRole('textbox', { name: 'Comment' });
  await field.fill('Shared note');
  await field.press('ControlOrMeta+Enter');
  await expect(bob.getByTestId('typst-note-card').locator('.typst-note-card__text')).toHaveText(['Shared note']);
  await expect(bob.getByTestId('typst-visual').locator('mark.typst-visual__note-range')).toHaveText('bold');
});

test('a reply from the other user: both see the thread in the card and in the PDF margin', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  // the package comes from the test fixture, not from packages.typst.org
  const drafting = readFileSync(resolve(import.meta.dirname, '../../src/core/typst-engine/fixtures/drafting-0.2.2.tar.gz'));
  for (const page of [ann, bob]) {
    await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) => route.fulfill({ body: drafting, contentType: 'application/gzip' }));
  }
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'bold' }).dblclick();
  await ann.keyboard.press('ControlOrMeta+Alt+KeyM');
  const annField = ann.getByTestId('typst-note-card').getByRole('textbox', { name: 'Comment' });
  await annField.fill('Is this right?');
  await annField.press('ControlOrMeta+Enter');

  const bobCard = bob.getByTestId('typst-note-card');
  await expect(bobCard.locator('.typst-note-card__text')).toHaveText(['Is this right?']);
  // Ann's message is not Bob's to edit
  await expect(bobCard.getByRole('button', { name: 'Edit message' })).toHaveCount(0);
  await bobCard.locator('.typst-note-card__head').click();
  const bobField = bobCard.getByRole('textbox', { name: 'Reply' });
  await bobField.fill('Yes, checked.');
  await bobField.press('ControlOrMeta+Enter');

  for (const page of [ann, bob]) {
    const card = page.getByTestId('typst-note-card');
    await expect(card.locator('.typst-note-card__author')).toHaveText(['Ann', 'Bob']);
    await expect(card.locator('.typst-note-card__text')).toHaveText(['Is this right?', 'Yes, checked.']);
    // drafting draws the note (both messages) in the page's right margin: the last 4cm of 16cm
    await expect.poll(() => page.getByTestId('typst-preview').locator('.typst-preview__page svg').first().evaluate((svg) => {
      const box = svg.getBoundingClientRect();
      const margin = box.left + box.width * (1 - 4 / 16);
      return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
    })).toBeGreaterThan(20);
  }
});
