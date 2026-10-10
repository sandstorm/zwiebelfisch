// End-to-end tests (Playwright, against the demo build): real-world tables in the Visual view (expression cells, table figures).
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const visual = (page: Page) => page.locator('[data-testid=typst-visual]:visible');
const toolbar = (page: Page) => page.locator('[role=toolbar][aria-label=Formatting]:visible');

/** The text of `path` in the editor's project. */
const fileText = (page: Page, path: string) => () =>
  page.locator('typst-editor').evaluate((el: Editor, path) => {
    const file = el.files[path];
    return typeof file === 'string' ? file : new TextDecoder().decode(file);
  }, path);

test.describe('a table with expression cells (plain page, boxes rendered)', () => {
  const SOURCE = '#let ms(v) = [#v ms]\n\n#table(\n    columns: 2,\n    table.header([*Pages*], [*Cold*]),\n    [1], ms(18),\n  )\n';
  const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);

  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/plain-html/');
    await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
    await page.locator('typst-editor').evaluate((el: Editor, source) => (el.value = source), SOURCE);
  });

  test('is a Visual table: header cells, the expression a compiled box', async ({ page }) => {
    const table = page.getByTestId('typst-visual').locator('table');
    await expect(table.locator('th')).toHaveText(['Pages', 'Cold']);
    const box = table.locator('td .typst-visual__raw-inline');
    await expect(box.locator('img.typst-visual__rendering')).toBeVisible();
  });

  test("editing the expression's code changes only it", async ({ page }) => {
    const box = page.getByTestId('typst-visual').locator('td .typst-visual__raw-inline');
    await box.locator('img.typst-visual__rendering').click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('0');
    await page.keyboard.press('Escape');
    await expect.poll(value(page)).toBe(SOURCE.replace('ms(18)', 'ms(180)'));
  });
});

test.describe('the advanced example', () => {
  const RESULTS = '/chapters/results.typ';

  test.beforeEach(async ({ page }) => {
    await page.goto(`/?example=advanced#${RESULTS}`);
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  });

  test('the timings table is a table figure with a caption, not a raw box', async ({ page }) => {
    const figure = visual(page).locator('figure').filter({ has: page.locator('table') });
    await expect(figure.locator('tr')).toHaveCount(5);
    await expect(figure.locator('th')).toHaveText(['Pages', 'Cold', 'Incremental', 'Speed-up']);
    await expect(figure.locator('figcaption')).toHaveText('Median compile times (illustrative numbers).');
  });

  test('typing in a cell or the caption changes only that; Add row keeps the indentation', async ({ page }) => {
    const before = await fileText(page, RESULTS)();
    const figure = visual(page).locator('figure').filter({ has: page.locator('table') });
    await figure.locator('td', { hasText: '68.3×' }).locator('p').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect.poll(fileText(page, RESULTS)).toBe(before.replace('[68.3×]', '[68.3×!]'));
    await toolbar(page).getByRole('button', { name: 'Add row' }).click();
    await expect.poll(fileText(page, RESULTS)).toContain('[68.3×!],\n    [], [], [], [],\n  ),');
  });
});
