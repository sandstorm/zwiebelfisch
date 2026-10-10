// End-to-end tests (Playwright, against the demo build): comments as margin notes and the notes gutter.
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
const cards = (page: Page) => page.getByTestId('typst-note-card');
/** The reply box of card `i` ("Comment" while the note is empty). */
const noteField = (page: Page, i = 0) => cards(page).nth(i).getByRole('textbox', { name: /^(Comment|Reply)$/ });
const messageTexts = (page: Page, i = 0) => cards(page).nth(i).locator('.typst-note-card__text');
const highlight = (page: Page) => visual(page).locator('mark.typst-visual__note-range');
/** "Comment" in the Visual view's formatting toolbar. */
const commentButton = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Comment' });
/** "Comment" in the tab bar (its menu `editor/title`), shown with the Source view. */
const sourceCommentButton = (page: Page) => page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'Comment' });
/** The demo signs as "Demo user" (Local mode), with the local date. */
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const signed = (text: string) => `- *Demo user* (${today}): ${text}`;
/** The main file's text, from the demo's editor API. */
const sourceText = (page: Page) => () => page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);
/** The vertical distance between the top of a card and the top of `anchor`. */
const offset = async (card: ReturnType<typeof cards>, anchor: ReturnType<typeof cards>) => {
  const [a, b] = await Promise.all([card.boundingBox(), anchor.boundingBox()]);
  return Math.abs(a!.y - b!.y);
};

/**
 * How many glyphs the first preview page draws in its right margin. The demo's
 * `margin: 1.5cm` becomes `(right: 4cm, rest: 1.5cm)` with the first note (drafting 0.2.2
 * fails on a single-length margin), so the note margin is the last 4cm of 16cm.
 */
const marginGlyphs = (page: Page) => () =>
  page.getByTestId('typst-preview').locator('.typst-preview__page svg').first().evaluate((svg) => {
    const page = svg.getBoundingClientRect();
    const margin = page.left + page.width * (1 - 4 / 16);
    return [...svg.querySelectorAll('use')].filter((glyph) => glyph.getBoundingClientRect().left >= margin).length;
  });

/** Selects the demo's bold word and comments on it (`#margin-note[*bold*][..]`), writing `note` into the new card. */
async function commentOnBold(page: Page, note: string) {
  await visual(page).locator('strong', { hasText: 'bold' }).dblclick();
  await commentButton(page).click();
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill(note);
  await noteField(page).press('ControlOrMeta+Enter');
}

test('a comment on selected text becomes a range note with a card in the gutter, beside its text', async ({ page }) => {
  await commentOnBold(page, 'Check this');

  await expect(highlight(page)).toHaveText('bold');
  await expect(cards(page)).toHaveCount(1);
  await expect(messageTexts(page)).toHaveText(['Check this']);
  await expect(cards(page).first().locator('.typst-note-card__author')).toHaveText('Demo user');
  await expect(cards(page).first().locator('.typst-note-card__quote')).toHaveText('bold');
  // the card sits at the height of its highlighted text
  await expect.poll(() => offset(cards(page).first(), highlight(page))).toBeLessThan(4);

  await expect.poll(sourceText(page)).toContain(`#margin-note[*bold*][${signed('Check this')}]`);
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
  // drafting's look in the PDF comes with the import, once
  expect((await sourceText(page)()).split('#set-margin-note-defaults(').length).toBe(2);
  expect(await sourceText(page)()).toContain('margin: (right: 4cm, rest: 1.5cm)');
  // the text now ends 4cm before the page edge: whatever is drawn beyond is the note
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);

  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source').locator('.cm-content')).toContainText(`#margin-note[*bold*][${signed('Check this')}]`);
});

test('a comment at the cursor becomes a point note; a second note does not repeat the import', async ({ page }) => {
  await visual(page).locator('p', { hasText: 'This is' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+Alt+KeyM');
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill('Point note');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect.poll(sourceText(page)).toContain(`#margin-note[${signed('Point note')}]`);
  await expect(visual(page).getByTestId('typst-note-marker')).toHaveCount(1);

  await visual(page).locator('h1').click();
  await commentButton(page).click();
  await expect(cards(page)).toHaveCount(2);
  // the new note is above the first one: its card comes first and has the focus
  await expect(noteField(page, 0)).toBeFocused();
  await noteField(page, 0).fill('Second');
  await noteField(page, 0).press('ControlOrMeta+Enter');
  await expect.poll(sourceText(page)).toContain(`#margin-note[${signed('Second')}]`);
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
});

test('cards of notes on the same line do not overlap', async ({ page }) => {
  for (const note of ['One', 'Two']) {
    await visual(page).locator('p', { hasText: 'This is' }).click();
    await page.keyboard.press('End');
    await commentButton(page).click();
    await noteField(page, note === 'One' ? 0 : 1).fill(`${note}\nwith a second line`);
    await page.keyboard.press('ControlOrMeta+Enter');
  }
  await expect(cards(page)).toHaveCount(2);
  await expect.poll(async () => {
    const [a, b] = await Promise.all([cards(page).nth(0).boundingBox(), cards(page).nth(1).boundingBox()]);
    return b!.y - (a!.y + a!.height);
  }).toBeGreaterThanOrEqual(0);
});

test('editing an own message updates the source and the preview', async ({ page }) => {
  await commentOnBold(page, 'Short');
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
  const before = await marginGlyphs(page)();

  const edit = cards(page).first().getByRole('button', { name: 'Edit message' });
  const field = cards(page).first().getByRole('textbox', { name: 'Edit message' });
  await edit.click();
  await expect(field).toBeFocused();
  await field.fill('A much longer note than before');
  // leaving the field saves, too
  await visual(page).locator('h1').click();
  await expect.poll(sourceText(page)).toContain(`#margin-note[*bold*][${signed('A much longer note than before')}]`);
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(before);

  await edit.click();
  await field.fill('Never saved');
  await field.press('Escape');
  await expect(messageTexts(page)).toHaveText(['A much longer note than before']);
});

test('a reply appends a message to the thread, in the card and in the source', async ({ page }) => {
  await commentOnBold(page, 'Is this right?');
  await cards(page).first().locator('.typst-note-card__head').click();
  await expect(noteField(page)).toBeFocused();
  await noteField(page).fill('Yes: #1 [checked]');
  await noteField(page).press('ControlOrMeta+Enter');
  await expect(messageTexts(page)).toHaveText(['Is this right?', 'Yes: #1 [checked]']);
  await expect.poll(sourceText(page)).toContain(`#margin-note[*bold*][${signed('Is this right?')}\n${signed('Yes: \\#1 \\[checked\\]')}]`);
  // the last own message can be deleted again
  await cards(page).first().getByRole('button', { name: 'Delete message' }).click();
  await expect(messageTexts(page)).toHaveText(['Is this right?']);
});

test('resolving a range note keeps its text; resolving a point note removes it', async ({ page }) => {
  await commentOnBold(page, 'Range');
  await visual(page).locator('h1').click();
  await page.keyboard.press('End');
  await commentButton(page).click();
  await noteField(page, 0).fill('Point');
  await noteField(page, 0).press('ControlOrMeta+Enter');
  await expect(cards(page)).toHaveCount(2);

  await cards(page).nth(1).getByRole('button', { name: 'Resolve note' }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(highlight(page)).toHaveCount(0);
  await expect.poll(sourceText(page)).toContain('This is *bold* and');

  await cards(page).first().getByRole('button', { name: 'Resolve note' }).click();
  await expect(cards(page)).toHaveCount(0);
  await expect.poll(sourceText(page)).not.toContain('#margin-note[');
  await expect(visual(page).locator('h1')).toHaveText('Hello Typst');
});

test('a highlight and its card highlight each other', async ({ page }) => {
  await commentOnBold(page, 'Linked');
  await visual(page).locator('h1').click();
  await expect(cards(page).first()).not.toHaveClass(/typst-note-card--active/);

  await highlight(page).click();
  await expect(cards(page).first()).toHaveClass(/typst-note-card--active/);

  await visual(page).locator('h1').click();
  await cards(page).first().hover();
  await expect(visual(page).locator('.typst-visual__note-anchor--hover')).toHaveCount(1);
});

test('on a narrow pane, a card pops up below its highlight', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await commentOnBold(page, 'Narrow');
  await visual(page).locator('h1').click();
  await expect(cards(page).first()).toBeHidden();

  await highlight(page).click();
  await expect(cards(page).first()).toBeVisible();
  const [card, mark] = await Promise.all([cards(page).first().boundingBox(), highlight(page).boundingBox()]);
  expect(card!.y).toBeGreaterThanOrEqual(mark!.y + mark!.height);
});

test('in the Source view, Comment (in the tab bar) wraps the selection and puts the cursor into the note', async ({ page }) => {
  await expect(sourceCommentButton(page)).toBeHidden();
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.getByTestId('typst-source');
  await source.locator('.cm-line', { hasText: 'This is' }).click();
  // CodeMirror's Home / End stop at the wrap points of a wrapped line first: repeat to reach its ends
  for (let i = 0; i < 3; i++) await page.keyboard.press('Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+End');
  await sourceCommentButton(page).click();
  await page.keyboard.type('Whole sentence?');
  await expect.poll(sourceText(page)).toMatch(/#margin-note\[This is .*\]\[Whole sentence\?\]/);
  await expect.poll(sourceText(page)).toMatch(new RegExp(`^${IMPORT.replace(/[.*()[\]]/g, '\\$&')}\n`));
});
