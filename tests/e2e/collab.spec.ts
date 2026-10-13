// End-to-end tests (Playwright, against the demo build): two users in one room (needs the collaboration server: mise run test:e2e-collab).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { SERVER_DEMO, serve, signIn, test } from './fixtures';

// Two users in one room of the local collaboration server. Needs the server:
// run through `mise run test:e2e-collab`, which starts it (ws://127.0.0.1:1234,
// plain rooms on). Each user signs in at its fake GitLab, in a browser session of their own.
test.skip(!process.env.TYPST_COLLAB_E2E, 'needs the collaboration server: mise run test:e2e-collab');
test.use({ baseURL: SERVER_DEMO });

async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const context = await browser.newContext();
  await signIn(context, user);
  const page = await context.newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${room}`);
  await expect(page.getByTestId('typst-visual')).toContainText('Typst in five minutes');
  return page;
}

/** How many glyphs the first preview page draws in its right margin (the last 4cm of 16cm: the notes). */
const marginGlyphs = (page: Page) => () =>
  page.getByTestId('typst-preview').locator('.typst-preview__page svg').first().evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const margin = box.left + box.width * (1 - 4 / 16);
    return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
  });

/**
 * The keys that move the Visual editor's caret to its line's end / start. On macOS End and Home scroll the page
 * (Playwright follows the platform's key bindings), Cmd+→ / Cmd+← move the caret there.
 */
const MAC = process.platform === 'darwin';
const LINE_END = MAC ? 'Meta+ArrowRight' : 'End';
const LINE_START = MAC ? 'Meta+ArrowLeft' : 'Home';

async function users(browser: Browser, baseURL: string, project: string) {
  const room = `e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ann = await join(browser, baseURL, room, 'Ann');
  const bob = await join(browser, baseURL, room, 'Bob');
  return { ann, bob };
}

test('an edit in one Source editor shows up in the other user’s Visual and Source editors', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: 'Typst is a markup' }).click();
  // the line wraps in the narrow editor: Home goes to the start of the row clicked, again to the line's
  await ann.keyboard.press('Home');
  await ann.keyboard.press('Home');
  await ann.keyboard.type('Together: ');
  await expect(bob.getByTestId('typst-visual')).toContainText('Together: Typst is');
  await bob.getByRole('tab', { name: 'Source' }).click();
  await expect(bob.getByTestId('typst-source')).toContainText('Together: Typst is');
});

test('edits from both Visual editors converge', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('h1').click();
  await ann.keyboard.press(LINE_END);
  await ann.keyboard.type(' (Ann)');
  await bob.getByTestId('typst-visual').locator('li', { hasText: 'Type something.' }).click();
  await bob.keyboard.press(LINE_END);
  await bob.keyboard.type(' (Bob)');
  for (const page of [ann, bob]) {
    await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Typst in five minutes (Ann)');
    await expect(page.getByTestId('typst-visual').locator('li', { hasText: 'Type something.' })).toHaveText('Type something. (Bob)');
  }
});

test('the other user’s selection is shown with their name', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'stars' }).dblclick();
  const selection = bob.getByTestId('typst-visual').locator('.typst-collaboration__selection');
  await expect(selection).toHaveText('stars');
  await expect(selection.first()).toHaveAttribute('data-user', 'Ann');
});

test('the other user’s caret shows with their name in both editors, where they moved it last, and their file is marked in the tree', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('h1').click();
  await ann.keyboard.press(LINE_END);
  const visualCaret = bob.getByTestId('typst-visual').locator('h1 .typst-collaboration__caret[data-user="Ann"]');
  await expect(visualCaret).toHaveCount(1);
  await expect(visualCaret.locator('.typst-collaboration__caret-flag')).toBeVisible();
  await expect(visualCaret.locator('.typst-collaboration__caret-flag')).toHaveText('Ann');
  // Regression: the caret is published after the move, not one step behind (at the click position).
  const textBefore = () =>
    visualCaret.evaluate((caret) => {
      const range = document.createRange();
      range.setStart(caret.closest('h1')!, 0);
      range.setEndBefore(caret);
      return range.toString();
    });
  await expect.poll(textBefore).toBe('Typst in five minutes');
  await ann.keyboard.press(LINE_START);
  await expect.poll(textBefore).toBe('');
  // the collaboration extension's file decoration: Ann's initial on her file in Bob's file tree (the panel may be closed)
  const decoration = bob.getByTestId('typst-files').locator('[data-path="/main.typ"] .typst-files__decoration');
  await expect(decoration).toHaveText('A');
  await expect(decoration).toHaveAttribute('title', 'Ann');
  await bob.getByRole('tab', { name: 'Source' }).click();
  const line = bob.getByTestId('typst-source').locator('.cm-line', { hasText: 'Typst in five minutes' });
  const sourceCaret = line.locator('.typst-collaboration__caret[data-user="Ann"]');
  await expect(sourceCaret).toHaveCount(1);
  await sourceCaret.hover({ force: true });
  await expect(sourceCaret.locator('.typst-collaboration__caret-flag')).toHaveCSS('opacity', '1');
});

test('a caret on an empty line shows in the other user’s Source editor', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('typst-source').locator('.cm-line', { hasText: /^$/ }).first().click();
  await bob.getByRole('tab', { name: 'Source' }).click();
  // `has` looks inside each line: the caret's locator starts there, not at the page
  const caret = bob.locator('.typst-collaboration__caret[data-user="Ann"]');
  await expect(bob.getByTestId('typst-source').locator('.cm-line', { has: caret })).toHaveText('Ann');
});

test('a margin note reaches the other user', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'stars' }).dblclick();
  await ann.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' }).click();
  const field = ann.getByTestId('typst-note-card').getByRole('textbox', { name: 'Comment' });
  await field.fill('Shared note');
  await field.press('ControlOrMeta+Enter');
  // Bob sees the marker (its tooltip: author and words) and opens the card from it
  const marker = bob.getByTestId('typst-visual').locator('[data-testid="typst-note-marker"][title^="Ann:"]');
  await expect(marker).toHaveAttribute('title', 'Ann: Shared note');
  await expect(bob.getByTestId('typst-visual').locator('mark.typst-comments__range').first()).toHaveText('stars');
  await marker.click();
  await expect(bob.getByTestId('typst-note-card').locator('.typst-comments__card-text')).toHaveText(['Shared note']);
});

test('a reply from the other user: both see the thread in the card and in the PDF margin', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  // the package comes from the test fixture, not from packages.typst.org
  const drafting = readFileSync(resolve(import.meta.dirname, '../../src/extensions/comments/model/fixtures/drafting-0.2.2.tar.gz'));
  for (const page of [ann, bob]) {
    await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) => route.fulfill({ body: drafting, contentType: 'application/gzip' }));
  }
  await expect.poll(marginGlyphs(ann)).toBeGreaterThan(0);
  const demoNote = await marginGlyphs(ann)();
  await ann.getByTestId('typst-visual').locator('strong', { hasText: 'stars' }).dblclick();
  await ann.keyboard.press('ControlOrMeta+Alt+KeyM');
  const annField = ann.getByTestId('typst-note-card').getByRole('textbox', { name: 'Comment' });
  await annField.fill('Is this right?');
  await annField.press('ControlOrMeta+Enter');

  // Ann's card stays open; Bob opens his from the note's marker
  await bob.getByTestId('typst-visual').locator('[data-testid="typst-note-marker"][title^="Ann:"]').click();
  const bobCard = bob.getByTestId('typst-note-card');
  await expect(bobCard.locator('.typst-comments__card-text')).toHaveText(['Is this right?']);
  // Ann's message is not Bob's to edit
  await expect(bobCard.getByRole('button', { name: 'Edit message' })).toHaveCount(0);
  const bobField = bobCard.getByRole('textbox', { name: 'Reply' });
  await expect(bobField).toBeFocused();
  await bobField.fill('Yes, checked.');
  await bobField.press('ControlOrMeta+Enter');

  // Bob's reply shows on Ann's open card at once
  for (const page of [ann, bob]) {
    const card = page.getByTestId('typst-note-card');
    await expect(card.locator('.typst-comments__card-author')).toHaveText(['Ann', 'Bob']);
    await expect(card.locator('.typst-comments__card-text')).toHaveText(['Is this right?', 'Yes, checked.']);
    // drafting draws the note (both messages) in the page's right margin, beside the demo's own note
    await expect.poll(marginGlyphs(page)).toBeGreaterThan(demoNote + 20);
  }
});
