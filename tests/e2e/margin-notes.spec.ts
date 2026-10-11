// End-to-end tests (Playwright, against the demo build): comments as margin notes, their markers and floating cards.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';

const DRAFTING = readFileSync(resolve(import.meta.dirname, '../../src/extensions/comments/model/fixtures/drafting-0.2.2.tar.gz'));
const IMPORT = '#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults';

test.beforeEach(async ({ page }) => {
  // the package comes from the test fixture, not from packages.typst.org
  await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) =>
    route.fulfill({ body: DRAFTING, contentType: 'application/gzip' }));
  await page.goto('/');
});

const visual = (page: Page) => page.getByTestId('typst-visual');
/** The open card (one at a time). */
const card = (page: Page) => page.getByTestId('typst-note-card');
/** The open card's reply box ("Comment" while the note is empty). */
const noteField = (page: Page) => card(page).getByRole('textbox', { name: /^(Comment|Reply)$/ });
const messageTexts = (page: Page) => card(page).locator('.typst-comments__card-text');
const highlight = (page: Page) => visual(page).locator('mark.typst-comments__range', { hasText: 'stars' });
/** The markers (speech bubbles) of the notes the demo user started. */
const ownMarkers = (page: Page) => visual(page).locator('[data-testid="typst-note-marker"][title^="Demo user:"]');
/** "Comment" in the Visual editor's formatting toolbar. */
const commentButton = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' });
/** "Comment" in the tab bar (its menu `editor/title`), shown with the Source editor. */
const sourceCommentButton = (page: Page) => page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Comment' });
/** The demo signs as "Demo user" (Local mode), with the local date. */
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const signed = (text: string) => `- *Demo user* (${today}): ${text}`;
/** The main file's text, from the demo's editor API. */
const sourceText = (page: Page) => () => page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);

/**
 * How many glyphs the first preview page draws in its right margin. The demo's
 * page has `margin: (right: 4cm, rest: 1.5cm)` (drafting 0.2.2 fails on a
 * single-length margin), so the note margin is the last 4cm of 16cm. The demo
 * has a note of its own (drawn there, after every note the tests add).
 */
const marginGlyphs = (page: Page) => () =>
  page.getByTestId('typst-preview').locator('.typst-preview__page svg').first().evaluate((svg) => {
    const page = svg.getBoundingClientRect();
    const margin = page.left + page.width * (1 - 4 / 16);
    return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
  });

/** Selects the demo's first strong word and comments on it (`#margin-note[*stars*][..]`), writing `note` into the new card. */
async function commentOnStrong(page: Page, note: string) {
  await visual(page).locator('strong', { hasText: 'stars' }).dblclick();
  await commentButton(page).click();
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill(note);
  await noteField(page).press('ControlOrMeta+Enter');
}

test('a comment on selected text becomes a range note: highlighted, a marker, a card floating below it', async ({ page }) => {
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
  const demoNote = await marginGlyphs(page)();
  // no column of cards beside the text: no card until one is opened
  await expect(card(page)).toHaveCount(0);
  await commentOnStrong(page, 'Check this');

  await expect(highlight(page)).toHaveText('stars');
  // sending keeps the card open, with the message in its thread
  await expect(card(page)).toHaveCount(1);
  await expect(card(page)).toHaveAttribute('role', 'dialog');
  await expect(messageTexts(page)).toHaveText(['Check this']);
  await expect(card(page).locator('.typst-comments__card-author')).toHaveText('Demo user');
  await expect(card(page).locator('.typst-comments__card-quote')).toHaveText('stars');
  await expect(ownMarkers(page)).toHaveAttribute('title', 'Demo user: Check this');
  // the card floats below its marker, over the text
  const [box, marker] = await Promise.all([card(page).boundingBox(), ownMarkers(page).boundingBox()]);
  expect(box!.y).toBeGreaterThanOrEqual(marker!.y + marker!.height - 1);

  await expect.poll(sourceText(page)).toContain(`#margin-note[*stars*][${signed('Check this')}]`);
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
  // drafting's look in the PDF comes with the import, once
  expect((await sourceText(page)()).split('#set-margin-note-defaults(').length).toBe(2);
  expect(await sourceText(page)()).toContain('margin: (right: 4cm, rest: 1.5cm)');
  // the text ends 4cm before the page edge: whatever is drawn beyond is a note
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(demoNote);

  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source').locator('.cm-content')).toContainText(`#margin-note[*stars*][${signed('Check this')}]`);
});

test('a comment at the cursor becomes a point note; a second note does not repeat the import', async ({ page }) => {
  await visual(page).locator('p', { hasText: 'Typst is a markup' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+Alt+KeyM');
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill('Point note');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect.poll(sourceText(page)).toContain(`#margin-note[${signed('Point note')}]`);
  await expect(ownMarkers(page)).toHaveCount(1);
  await noteField(page).press('Escape');
  await expect(card(page)).toHaveCount(0);

  await visual(page).locator('h1').click();
  await commentButton(page).click();
  // the new note's card opens, alone, with the focus in its reply box
  await expect(card(page)).toHaveCount(1);
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill('Second');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect.poll(sourceText(page)).toContain(`#margin-note[${signed('Second')}]`);
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
  await expect(ownMarkers(page)).toHaveCount(2);
});

test('a marker tells its note on hover and opens its card on a click; Escape and a click elsewhere close it', async ({ page }) => {
  await commentOnStrong(page, 'Linked');
  await noteField(page).press('Escape');
  await expect(card(page)).toHaveCount(0);
  // the focus is back in the text
  await expect(visual(page)).toBeFocused();

  await expect(ownMarkers(page)).toHaveAttribute('title', 'Demo user: Linked');
  await ownMarkers(page).click();
  await expect(card(page)).toBeVisible();
  await expect(noteField(page)).toBeFocused();
  // the open note's text and marker are marked active
  await expect(visual(page).locator('.typst-comments__anchor--active').first()).toBeVisible();

  await visual(page).locator('h1').click();
  await expect(card(page)).toHaveCount(0);
});

test('a click into highlighted text shows its card, the caret stays; Alt+Enter goes into it', async ({ page }) => {
  await commentOnStrong(page, 'Peek');
  await visual(page).locator('h1').click();
  await expect(card(page)).toHaveCount(0);

  await highlight(page).click();
  await expect(card(page)).toBeVisible();
  await expect(visual(page)).toBeFocused();
  await page.keyboard.press('Alt+Enter');
  await expect(noteField(page)).toBeFocused();
  // Tab stays inside the card
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  await expect(card(page).locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(card(page)).toHaveCount(0);
  await expect(visual(page)).toBeFocused();
});

test('editing an own message updates the source and the preview', async ({ page }) => {
  await commentOnStrong(page, 'Short');
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
  const before = await marginGlyphs(page)();

  const edit = card(page).getByRole('button', { name: 'Edit message' });
  const field = card(page).getByRole('textbox', { name: 'Edit message' });
  await edit.click();
  await expect(field).toBeFocused();
  await field.fill('A much longer note than before');
  // leaving the field saves, too
  await noteField(page).click();
  await expect.poll(sourceText(page)).toContain(`#margin-note[*stars*][${signed('A much longer note than before')}]`);
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(before);

  await edit.click();
  await field.fill('Never saved');
  await field.press('Escape');
  await expect(messageTexts(page)).toHaveText(['A much longer note than before']);
  // that Escape ended the edit, not the card
  await expect(card(page)).toBeVisible();
});

test('a reply appends a message to the thread, in the card and in the source', async ({ page }) => {
  await commentOnStrong(page, 'Is this right?');
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill('Yes: #1 [checked]');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect(messageTexts(page)).toHaveText(['Is this right?', 'Yes: #1 [checked]']);
  await expect.poll(sourceText(page)).toContain(`#margin-note[*stars*][${signed('Is this right?')}\n${signed('Yes: \\#1 \\[checked\\]')}]`);
  // the last own message can be deleted again
  await card(page).getByRole('button', { name: 'Delete message' }).click();
  await expect(messageTexts(page)).toHaveText(['Is this right?']);
});

test('resolving a range note keeps its text; resolving a point note removes it', async ({ page }) => {
  await commentOnStrong(page, 'Range');
  await visual(page).locator('h1').click();
  await page.keyboard.press('End');
  await commentButton(page).click();
  await noteField(page).fill('Point');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect(ownMarkers(page)).toHaveCount(2);

  // the point note's card is open: resolve it
  await card(page).getByRole('button', { name: 'Resolve note' }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(ownMarkers(page)).toHaveCount(1);
  await expect(visual(page).locator('h1')).toHaveText('Typst in five minutes');

  await ownMarkers(page).click();
  await card(page).getByRole('button', { name: 'Resolve note' }).click();
  await expect(highlight(page)).toHaveCount(0);
  await expect.poll(sourceText(page)).toContain('*stars* make text strong');
  await expect.poll(sourceText(page)).not.toContain('*Demo user*');
});

test('on a narrow pane, the card fits beside its marker', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await commentOnStrong(page, 'Narrow');
  const [box, text] = await Promise.all([card(page).boundingBox(), visual(page).boundingBox()]);
  expect(box!.x).toBeGreaterThanOrEqual(text!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(text!.x + text!.width + 1);
});

test('in the Source editor, Comment (in the tab bar) wraps the selection and puts the cursor into the note', async ({ page }) => {
  await expect(sourceCommentButton(page)).toBeHidden();
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.getByTestId('typst-source');
  await source.locator('.cm-line', { hasText: 'Typst is a markup' }).click();
  // CodeMirror's Home / End stop at the wrap points of a wrapped line first: repeat to reach its ends
  for (let i = 0; i < 3; i++) await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+End');
  await sourceCommentButton(page).click();
  await page.keyboard.type('Whole sentence?');
  await expect.poll(sourceText(page)).toMatch(/#margin-note\[Typst is a markup .*\]\[Whole sentence\?\]/);
  await expect.poll(sourceText(page)).toMatch(new RegExp(`^${IMPORT.replace(/[.*()[\]]/g, '\\$&')}\n`));
});
