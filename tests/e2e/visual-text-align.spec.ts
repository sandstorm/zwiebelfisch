// End-to-end tests (Playwright, against the demo build): text alignment in the Visual editor.
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { caretAtEnd, chooseFrom } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Adds a new paragraph "Fresh line" after the first paragraph, cursor in it. */
async function freshLine(page: Page) {
  await caretAtEnd(page.getByTestId('typst-visual').locator('p').first());
  await page.keyboard.press('Enter');
  await page.keyboard.type('Fresh line');
}

async function source(page: Page) {
  await page.getByRole('tab', { name: 'Source' }).click();
  return page.getByTestId('typst-source');
}

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const freshParagraph = (page: Page) => page.getByTestId('typst-visual').locator('p', { hasText: 'Fresh line' });

test('Center wraps the paragraph in #align(center) and shows it centered', async ({ page }) => {
  await freshLine(page);
  await chooseFrom(toolbar(page), 'Align', 'Center');
  await expect(toolbar(page).getByRole('menuitem', { name: 'Center', includeHidden: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'center');
  await expect(await source(page)).toContainText('#align(center)[Fresh line]');
});

test('Align right, then Align left removes the wrapper again', async ({ page }) => {
  await freshLine(page);
  await chooseFrom(toolbar(page), 'Align', 'Align right');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'right');
  await chooseFrom(toolbar(page), 'Align', 'Align left');
  const src = await source(page);
  await expect(src).toContainText('Fresh line');
  // the demo has an #align(center)[..] of its own further down
  await expect(src).not.toContainText('#align(right)');
  await expect(src).not.toContainText('[Fresh line]');
});

test('Justify wraps the paragraph in #par(justify: true)', async ({ page }) => {
  await freshLine(page);
  await chooseFrom(toolbar(page), 'Align', 'Justify');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'justify');
  await expect(await source(page)).toContainText('#par(justify: true)[Fresh line]');
});

test('Mod+Shift+E centers and Mod+Shift+L aligns left', async ({ page }) => {
  await freshLine(page);
  await page.keyboard.press('ControlOrMeta+Shift+E');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'center');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  // left is the document's default, so the paragraph has no alignment of its own: CSS's `start`, left in LTR text
  await expect(freshParagraph(page)).toHaveCSS('text-align', /^(left|start)$/);
  // a menu's items show their state only while it is open
  await toolbar(page).getByRole('button', { name: 'Align', exact: true }).click();
  await expect(toolbar(page).getByRole('menuitem', { name: 'Align left' })).toHaveAttribute('aria-pressed', 'true');
});

test('one undo reverts an alignment', async ({ page }) => {
  await freshLine(page);
  await chooseFrom(toolbar(page), 'Align', 'Center');
  await toolbar(page).getByRole('button', { name: 'Undo' }).click();
  await expect(await source(page)).not.toContainText('#align(center)');
});
