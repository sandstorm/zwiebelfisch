// End-to-end tests (Playwright, against the demo build): block nodes in the Visual view (page break, rule, task lists).
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { caretAtEnd } from './visual-helpers';

/** Block nodes modelled on Tiptap's: quote, page break, rule, table header, task list, heading numbers. */

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const visual = (page: Page) => page.getByTestId('typst-visual');
type Demo = { editor: { source: string } };
const sourceText = (page: Page) => () => page.evaluate(() => (window as unknown as Demo).editor.source);
const setSource = (page: Page, text: string) =>
  page.evaluate((value) => ((window as unknown as Demo).editor.source = value), text);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await setSource(page, '= Plan\n\nFirst paragraph\n');
});

/** Puts the cursor at the end of the paragraph and opens a new empty one after it. */
async function newParagraph(page: Page) {
  await caretAtEnd(visual(page).locator('p', { hasText: 'First paragraph' }));
  await page.keyboard.press('Enter');
}

test('"> " starts a quote; typed text lands in #quote(block: true)[..]', async ({ page }) => {
  await newParagraph(page);
  await page.keyboard.type('> Wise words');
  await expect(visual(page).locator('blockquote')).toHaveText('Wise words');
  await expect.poll(sourceText(page)).toContain('\n\n#quote(block: true)[Wise words]');
});

test('"---" on an empty line becomes a rule, in text it stays text', async ({ page }) => {
  await newParagraph(page);
  await page.keyboard.type('---');
  await expect(visual(page).locator('.typst-visual__rule hr')).toHaveCount(1);
  await expect.poll(sourceText(page)).toContain('\n\n#line(length: 100%)\n');
  await page.keyboard.type('a---b');
  await expect.poll(sourceText(page)).toContain('a\\-\\--b');
});

test('Insert page break shows a labelled divider and writes #pagebreak()', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p', { hasText: 'First paragraph' }));
  await toolbar(page).getByRole('button', { name: 'Insert page break' }).click();
  await expect(visual(page).locator('.typst-visual__page-break')).toHaveText('Page break');
  await expect.poll(sourceText(page)).toContain('First paragraph\n\n#pagebreak()');
});

test('Header row turns the first table row into table.header(..)', async ({ page }) => {
  await setSource(page, '#table(columns: 2, [a], [b], [c], [d])\n');
  await visual(page).locator('td', { hasText: 'c' }).click();
  await toolbar(page).getByRole('button', { name: 'Header row' }).click();
  await expect(visual(page).locator('th')).toHaveText(['a', 'b']);
  await expect.poll(sourceText(page)).toContain('table.header([a], [b]),');
});

test('Task list adds cheq once; clicking a checkbox flips [ ] to [x]', async ({ page }) => {
  await newParagraph(page);
  await page.keyboard.type('[ ] Buy milk');
  await expect.poll(sourceText(page)).toBe(
    '#import "@preview/cheq:0.4.0": checklist\n#show: checklist\n\n= Plan\n\nFirst paragraph\n\n- [ ] Buy milk\n',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.type('Eggs');
  await visual(page).getByRole('checkbox').first().click();
  await expect.poll(sourceText(page)).toContain('- [x] Buy milk\n- [ ] Eggs');
  expect((await sourceText(page)()).split('@preview/cheq').length).toBe(2);
});

test('a heading numbering set rule shows numbers right of the headings', async ({ page }) => {
  await setSource(page, '#set heading(numbering: "1.")\n\n= Intro\n\n== Detail\n\n= Next\n');
  const numbers = visual(page).locator('[data-heading-number]');
  await expect(numbers).toHaveCount(3);
  expect(await numbers.evaluateAll((els) => els.map((el) => el.getAttribute('data-heading-number')))).toEqual(['1.', '1.1.', '2.']);
  const gutter = await visual(page).locator('h1', { hasText: 'Intro' }).evaluate((el) => getComputedStyle(el, '::after').content);
  expect(gutter).toBe('"1."');
});
