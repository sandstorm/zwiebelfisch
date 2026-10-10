import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const DRAFTING = readFileSync(resolve(import.meta.dirname, '../../src/engine/fixtures/drafting-0.2.2.tar.gz'));
const IMPORT = '#import "@preview/drafting:0.2.2": margin-note';

test.beforeEach(async ({ page }) => {
  // the package comes from the test fixture, not from packages.typst.org
  await page.route('https://packages.typst.org/preview/drafting-0.2.2.tar.gz', (route) =>
    route.fulfill({ body: DRAFTING, contentType: 'application/gzip' }));
  await page.goto('/');
});

const visual = (page: Page) => page.getByTestId('typst-visual');
const bubbles = (page: Page) => visual(page).getByTestId('typst-margin-note');
const commentButton = (page: Page) => page.locator('.typst-editor__comment');
/** The main file's text, from the demo's editor API. */
const sourceText = (page: Page) => () => page.evaluate(() => (window as unknown as { editor: { source: string } }).editor.source);

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

test('a comment on selected text in the Visual view becomes a range margin note everywhere', async ({ page }) => {
  await visual(page).locator('strong', { hasText: 'bold' }).dblclick();
  await commentButton(page).click();

  const field = bubbles(page).getByRole('textbox', { name: 'Note' });
  await expect(field).toBeFocused();
  await field.fill('Check this');
  await field.press('Enter');

  await expect(visual(page).locator('mark.typst-visual__note-range')).toHaveText('bold');
  await expect(bubbles(page)).toHaveText('Check this');
  await expect.poll(sourceText(page)).toContain('#margin-note[bold][Check this]');
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
  expect(await sourceText(page)()).toContain('margin: (right: 4cm, rest: 1.5cm)');
  // the text now ends 4cm before the page edge: whatever is drawn beyond is the note
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);

  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source').locator('.cm-content')).toContainText('#margin-note[bold][Check this]');
});

test('a comment at the cursor becomes a point note; a second note does not repeat the import', async ({ page }) => {
  await visual(page).locator('p', { hasText: 'This is' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+Alt+KeyM');
  const field = bubbles(page).getByRole('textbox', { name: 'Note' });
  await expect(field).toBeFocused();
  await field.fill('Point note');
  await field.press('Enter');
  await expect.poll(sourceText(page)).toContain('#margin-note[Point note]');

  await visual(page).locator('h1').click();
  await commentButton(page).click();
  await bubbles(page).getByRole('textbox', { name: 'Note' }).fill('Second');
  await page.keyboard.press('Enter');
  await expect.poll(sourceText(page)).toContain('#margin-note[Second]');
  expect((await sourceText(page)()).split(IMPORT).length).toBe(2);
});

test('editing a note in the Visual view updates the source and the preview', async ({ page }) => {
  await visual(page).locator('strong', { hasText: 'bold' }).dblclick();
  await commentButton(page).click();
  await bubbles(page).getByRole('textbox', { name: 'Note' }).fill('Short');
  await page.keyboard.press('Enter');
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(0);
  const before = await marginGlyphs(page)();

  await bubbles(page).click();
  const field = bubbles(page).getByRole('textbox', { name: 'Note' });
  await expect(field).toHaveValue('Short');
  await field.fill('A much longer note than before');
  await field.press('Enter');
  await expect.poll(sourceText(page)).toContain('#margin-note[bold][A much longer note than before]');
  await expect.poll(marginGlyphs(page)).toBeGreaterThan(before);
});

test('in the Source view, Comment wraps the selection and puts the cursor into the note', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.getByTestId('typst-source');
  await source.locator('.cm-line', { hasText: 'This is' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await commentButton(page).click();
  await page.keyboard.type('Whole sentence?');
  await expect.poll(sourceText(page)).toMatch(/#margin-note\[This is .*\]\[Whole sentence\?\]/);
  await expect.poll(sourceText(page)).toMatch(new RegExp(`^${IMPORT.replace(/[.*()[\]]/g, '\\$&')}\n`));
});
