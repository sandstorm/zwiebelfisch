// End-to-end tests (Playwright, against the demo build): text alignment in the Visual view.
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Adds a new paragraph "Fresh line" after the first paragraph, cursor in it. */
async function freshLine(page: Page) {
  await page.getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('End');
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
  await toolbar(page).getByRole('button', { name: 'Center' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Center' })).toHaveAttribute('aria-pressed', 'true');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'center');
  await expect(await source(page)).toContainText('#align(center)[Fresh line]');
});

test('Align right, then Align left removes the wrapper again', async ({ page }) => {
  await freshLine(page);
  await toolbar(page).getByRole('button', { name: 'Align right' }).click();
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'right');
  await toolbar(page).getByRole('button', { name: 'Align left' }).click();
  const src = await source(page);
  await expect(src).toContainText('Fresh line');
  await expect(src).not.toContainText('#align(');
});

test('Justify wraps the paragraph in #par(justify: true)', async ({ page }) => {
  await freshLine(page);
  await toolbar(page).getByRole('button', { name: 'Justify' }).click();
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'justify');
  await expect(await source(page)).toContainText('#par(justify: true)[Fresh line]');
});

test('Mod+Shift+E centers and Mod+Shift+L aligns left', async ({ page }) => {
  await freshLine(page);
  await page.keyboard.press('ControlOrMeta+Shift+E');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'center');
  await page.keyboard.press('ControlOrMeta+Shift+L');
  await expect(freshParagraph(page)).toHaveCSS('text-align', 'left');
});

test('one undo reverts an alignment', async ({ page }) => {
  await freshLine(page);
  await toolbar(page).getByRole('button', { name: 'Center' }).click();
  await toolbar(page).getByRole('button', { name: 'Undo' }).click();
  await expect(await source(page)).not.toContainText('#align(center)');
});
