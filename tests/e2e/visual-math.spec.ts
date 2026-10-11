// End-to-end tests (Playwright, against the demo build): math typed in the Visual editor becomes a formula, drawn as
// its compiled picture; Insert → Inline math starts one with the caret inside.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, chooseFrom, compiled, sourceText, toolbar, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/?example=simple');
  await compiled(page);
});

/** A new empty line after the first paragraph, with the caret in it. */
async function newLine(page: Page): Promise<void> {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
}

test('typing $a^1$ makes inline math, shown as its compiled picture', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('With $a^1$ and more');
  await expect.poll(sourceText(page)).toContain('\nWith $a^1$ and more\n');
  const box = visual(page).locator('p .typst-visual__raw-inline').filter({ has: page.locator('img.typst-visual__rendering') });
  await expect(box.locator('img.typst-visual__rendering')).toBeVisible();
  await expect(box.locator('img.typst-visual__rendering')).toHaveAttribute('alt', '$a^1$');
});

test('$ x $ alone on a line makes display math, a block', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('$ x^2 $');
  await expect.poll(sourceText(page)).toContain('\n$ x^2 $\n');
  await expect(visual(page).locator('.typst-visual__raw-block img.typst-visual__rendering[alt="$ x^2 $"]')).toBeVisible();
});

test('a dollar after a backslash stays a dollar sign', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('Costs \\$5\\$');
  await expect.poll(sourceText(page)).toContain('Costs \\\\\\$5\\\\\\$');
});

test('Insert → Inline math puts the caret between the dollars', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('Area ');
  await chooseFrom(toolbar(page), 'Insert', 'Inline math');
  await expect(visual(page).locator('.typst-visual__raw-inline .cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.type('pi r^2');
  await expect.poll(sourceText(page)).toContain('\nArea $pi r^2$\n');
});
