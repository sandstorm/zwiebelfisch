// End-to-end tests (Playwright, against the demo build): the slash commands, `/` in the Visual editor.
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { caretAtEnd, compiled, sourceText, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

/** The slash commands' list of the shown editor. */
const list = (page: Page) => page.locator('[data-testid="typst-suggest"][data-trigger="/"]:visible');

/** A new empty line after the first paragraph, with the caret in it. */
async function newLine(page: Page): Promise<void> {
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
}

test('/ lists the Insert menu and the text styles below the caret; typing filters, also by keyword', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('/');
  await expect(list(page)).toBeVisible();
  await expect(list(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await expect(list(page).getByRole('option', { name: /Heading 2/ })).toBeVisible();
  const [box, caret] = await Promise.all([list(page).boundingBox(), visual(page).locator('.typst-visual__suggestion').boundingBox()]);
  expect(box!.y).toBeGreaterThanOrEqual(caret!.y + caret!.height - 1); // below the typed /
  await page.keyboard.type('spreadsheet');
  await expect(list(page).getByRole('option')).toHaveText([/^Insert table/]);
});

test('Enter removes the /query and runs the chosen entry', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('Fresh /h2');
  await page.keyboard.press('Enter');
  await expect(list(page)).toHaveCount(0);
  await expect.poll(sourceText(page)).toMatch(/\n== Fresh *\n/);
});

test('arrow keys choose, Escape closes and keeps the text', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('/quo');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await expect(list(page)).toHaveCount(0);
  await page.keyboard.type('te');
  await expect(list(page)).toHaveCount(0);
  await expect.poll(sourceText(page)).toContain('/quote');
});

test('a click on an entry runs it', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('/rule');
  await list(page).getByRole('option', { name: /Horizontal rule/ }).click();
  await expect.poll(sourceText(page)).toContain('#line(length: 100%)');
  await expect.poll(sourceText(page)).not.toContain('/rule');
});

test('an empty line holding the caret hints "Type / for commands" without taking room; typing removes it', async ({ page }) => {
  const hint = visual(page).locator('.typst-slash-commands__hint');
  await expect(hint).toHaveCount(0);
  const line = visual(page).locator('p').first();
  const { height } = (await line.boundingBox())!;
  await newLine(page);
  await expect(hint).toHaveCount(1);
  expect(await hint.evaluate((p) => getComputedStyle(p, '::before').content)).toContain('Type / for commands');
  expect((await hint.boundingBox())!.height).toBeLessThanOrEqual(height + 1); // one line, as an empty one
  await expect.poll(sourceText(page)).not.toContain('Type /');
  await page.keyboard.type('x');
  await expect(hint).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await expect(hint).toHaveCount(1);
  await page.keyboard.press('ArrowUp');
  await expect(hint).toHaveCount(0);
});

test('/ in a word or a URL lists nothing', async ({ page }) => {
  await newLine(page);
  await page.keyboard.type('and/or https://typst.app');
  await expect(list(page)).toHaveCount(0);
});
