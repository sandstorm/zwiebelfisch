// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): a
// spreadsheet (.ic) edited in IronCalc's workbook UI, its values read by Typst.
import type { Page } from '@playwright/test';
import { test, expect, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const fileText = (page: Page, path: string) => () =>
  editor(page).evaluate((el: Editor, path) => {
    const file = el.files[path];
    return file === undefined ? null : typeof file === 'string' ? file : new TextDecoder().decode(file);
  }, path);

test('a new spreadsheet opens in IronCalc; its computed values are written for Typst, which shows them', async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/budget.ic': '' };
    el.value = '#let budget = json("budget.ic.json")\n\nRent: #budget.Sheet1.at(0).at(1)\n';
  });
  await fileRow(editor(page), 'budget.ic').click();

  const sheet = editor(page).getByTestId('typst-spreadsheet');
  await expect(sheet.locator('.ic-root')).toBeVisible();
  // a new workbook is saved at once: the values file exists before any edit (the sheet is empty: an error)
  await expect.poll(fileText(page, '/budget.ic.json')).toContain('"Sheet1"');
  await expect(editor(page).getByTestId('typst-status')).not.toHaveText(/✓/);

  // A1 is selected: type into it, Tab to B1, a formula, Enter
  const grid = sheet.locator('canvas').first();
  const box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 32);
  await page.keyboard.type('Rent');
  await page.keyboard.press('Tab');
  await page.keyboard.type('=600*2');
  await page.keyboard.press('Enter');
  await expect.poll(fileText(page, '/budget.ic.json')).toContain('"1200"');
  expect(JSON.parse((await fileText(page, '/budget.ic.json')())!).Sheet1[0]).toEqual(['Rent', '1200']);

  // `budget.Sheet1.at(0)` fails on the empty new sheet; with the values in place the document compiles
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
});
