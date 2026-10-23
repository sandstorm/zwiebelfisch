// End-to-end tests (Playwright, against the demo build): two users in one room (needs the collaboration server: mise run test:e2e-collab).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Browser, type Locator, type Page } from '@playwright/test';
import { SERVER_DEMO, serve, signIn, test } from './fixtures';
import { caretAtEnd, caretAtStart, selectText } from './visual-helpers';

// Two users in one room of the local collaboration server. Needs the server:
// its config (playwright.collab.config.ts) starts it (ws://127.0.0.1:1234,
// plain rooms on). Each user signs in at its fake GitLab, in a browser session of their own.
test.use({ baseURL: SERVER_DEMO });

async function join(browser: Browser, baseURL: string, room: string, user: string): Promise<Page> {
  const context = await browser.newContext();
  await signIn(context, user);
  const page = await context.newPage();
  await serve(page, baseURL);
  await page.goto(`/?room=${room}`);
  await expect(page.getByTestId('zwf-visual')).toContainText('Typst in five minutes');
  return page;
}

/** How many glyphs the first preview page draws in its right margin (the last 4cm of 16cm: the notes). */
const marginGlyphs = (page: Page) => () =>
  page.getByTestId('zwf-preview').locator('.zwf-preview__page svg').first().evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const margin = box.left + box.width * (1 - 4 / 16);
    return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
  });

/** A remote caret's name flag (its `::after`) as drawn: the name and how opaque. */
const flag = (caret: Locator) => () =>
  caret.evaluate((element) => {
    const style = getComputedStyle(element, '::after');
    return { name: style.content, opacity: style.opacity };
  });

async function users(browser: Browser, baseURL: string, project: string) {
  const room = `e2e-${project}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ann = await join(browser, baseURL, room, 'Ann');
  const bob = await join(browser, baseURL, room, 'Bob');
  return { ann, bob };
}

test('an edit in one Source editor shows up in the other user’s Visual and Source editors', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('zwf-source').locator('.cm-line', { hasText: 'Typst is a markup' }).click();
  // the line wraps in the narrow editor: Home goes to the start of the row clicked, again to the line's
  await ann.keyboard.press('Home');
  await ann.keyboard.press('Home');
  await ann.keyboard.type('Together: ');
  await expect(bob.getByTestId('zwf-visual')).toContainText('Together: Typst is');
  await bob.getByRole('tab', { name: 'Source' }).click();
  await expect(bob.getByTestId('zwf-source')).toContainText('Together: Typst is');
});

test('edits from both Visual editors converge', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await caretAtEnd(ann.getByTestId('zwf-visual').locator('h1'));
  await ann.keyboard.type(' (Ann)');
  await caretAtEnd(bob.getByTestId('zwf-visual').locator('li p', { hasText: 'Type something.' }));
  await bob.keyboard.type(' (Bob)');
  for (const page of [ann, bob]) {
    await expect(page.getByTestId('zwf-visual').locator('h1')).toHaveText('Typst in five minutes (Ann)');
    await expect(page.getByTestId('zwf-visual').locator('li', { hasText: 'Type something.' })).toHaveText('Type something. (Bob)');
  }
});

test('the other user’s selection is shown with their name', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await selectText(ann.getByTestId('zwf-visual').locator('strong', { hasText: 'stars' }), 'stars');
  const selection = bob.getByTestId('zwf-visual').locator('.zwf-collaboration__selection');
  await expect(selection).toHaveText('stars');
  await expect(selection.first()).toHaveAttribute('data-user', 'Ann');
});

test('the other user’s caret shows with their name in both editors, where they moved it last, and their file is marked in the tree', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await caretAtEnd(ann.getByTestId('zwf-visual').locator('h1'));
  const visualCaret = bob.getByTestId('zwf-visual').locator('h1 .zwf-collaboration__caret[data-user="Ann"]');
  await expect(visualCaret).toHaveCount(1);
  await expect.poll(flag(visualCaret)).toEqual({ name: '"Ann"', opacity: '1' });
  // Regression: the caret is published after the move, not one step behind (at the click position).
  const textBefore = () =>
    visualCaret.evaluate((caret) => {
      const range = document.createRange();
      range.setStart(caret.closest('h1')!, 0);
      range.setEndBefore(caret);
      return range.toString();
    });
  await expect.poll(textBefore).toBe('Typst in five minutes');
  await caretAtStart(ann.getByTestId('zwf-visual').locator('h1'));
  await expect.poll(textBefore).toBe('');
  // the collaboration extension's file decoration: Ann's initial on her file in Bob's file tree (the panel may be closed)
  const decoration = bob.getByTestId('zwf-files').locator('[data-path="/main.typ"] .zwf-files__decoration');
  await expect(decoration).toHaveText('A');
  await expect(decoration).toHaveAttribute('title', 'Ann');
  await bob.getByRole('tab', { name: 'Source' }).click();
  const line = bob.getByTestId('zwf-source').locator('.cm-line', { hasText: 'Typst in five minutes' });
  const sourceCaret = line.locator('.zwf-collaboration__caret[data-user="Ann"]');
  await expect(sourceCaret).toHaveCount(1);
  // the pointer onto the caret by its box: WebKit's hover() never finishes on the caret
  const box = (await sourceCaret.boundingBox())!;
  await bob.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(flag(sourceCaret)).toEqual({ name: '"Ann"', opacity: '1' });
});

test('a caret on an empty line shows in the other user’s Source editor', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await ann.getByRole('tab', { name: 'Source' }).click();
  await ann.getByTestId('zwf-source').locator('.cm-line', { hasText: /^$/ }).first().click();
  await bob.getByRole('tab', { name: 'Source' }).click();
  // `has` looks inside each line: the caret's locator starts there, not at the page
  const caret = bob.locator('.zwf-collaboration__caret[data-user="Ann"]');
  // the name flag is no text: the line stays empty
  await expect(bob.getByTestId('zwf-source').locator('.cm-line', { has: caret })).toHaveText('');
});

test('a margin note reaches the other user', async ({ browser, baseURL }, info) => {
  const { ann, bob } = await users(browser, baseURL!, info.project.name);
  await selectText(ann.getByTestId('zwf-visual').locator('strong', { hasText: 'stars' }), 'stars');
  await ann.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' }).click();
  const field = ann.getByTestId('zwf-note-card').getByRole('textbox', { name: 'Comment' });
  await field.fill('Shared note');
  await field.press('ControlOrMeta+Enter');
  // Bob sees the marker (its tooltip: author and words) and opens the card from it
  const marker = bob.getByTestId('zwf-visual').locator('[data-testid="zwf-note-marker"][title^="Ann:"]');
  await expect(marker).toHaveAttribute('title', 'Ann: Shared note');
  await expect(bob.getByTestId('zwf-visual').locator('mark.zwf-comments__range').first()).toHaveText('stars');
  await marker.click();
  await expect(bob.getByTestId('zwf-note-card').locator('.zwf-comments__card-text')).toHaveText(['Shared note']);
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
  await selectText(ann.getByTestId('zwf-visual').locator('strong', { hasText: 'stars' }), 'stars');
  await ann.keyboard.press('ControlOrMeta+Alt+KeyM');
  const annField = ann.getByTestId('zwf-note-card').getByRole('textbox', { name: 'Comment' });
  await annField.fill('Is this right?');
  await annField.press('ControlOrMeta+Enter');

  // Ann's card stays open; Bob opens his from the note's marker
  await bob.getByTestId('zwf-visual').locator('[data-testid="zwf-note-marker"][title^="Ann:"]').click();
  const bobCard = bob.getByTestId('zwf-note-card');
  await expect(bobCard.locator('.zwf-comments__card-text')).toHaveText(['Is this right?']);
  // Ann's message is not Bob's to edit
  await expect(bobCard.getByRole('button', { name: 'Edit message' })).toHaveCount(0);
  const bobField = bobCard.getByRole('textbox', { name: 'Reply' });
  await expect(bobField).toBeFocused();
  await bobField.fill('Yes, checked.');
  await bobField.press('ControlOrMeta+Enter');

  // Bob's reply shows on Ann's open card at once
  for (const page of [ann, bob]) {
    const card = page.getByTestId('zwf-note-card');
    await expect(card.locator('.zwf-comments__card-author')).toHaveText(['Ann', 'Bob']);
    await expect(card.locator('.zwf-comments__card-text')).toHaveText(['Is this right?', 'Yes, checked.']);
    // drafting draws the note (both messages) in the page's right margin, beside the demo's own note
    await expect.poll(marginGlyphs(page)).toBeGreaterThan(demoNote + 20);
  }
});
