// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): a
// spreadsheet (.ic) edited in IronCalc's workbook UI, imported by Typst through its generated Typst file.
import { expect, type Page } from '@playwright/test';
import { test, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const fileText = (page: Page, path: string) => () =>
  editor(page).evaluate((el: Editor, path) => {
    const file = el.files[path];
    return file === undefined ? null : typeof file === 'string' ? file : new TextDecoder().decode(file);
  }, path);

test('a new spreadsheet opens in IronCalc; its Typst file (tables and values) is written, and Typst shows it', async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/budget.ic': '' };
    el.value = '#import "budget.ic.gen.typ": sheets, values\n\n#sheets.Sheet1\nRent: #values.Sheet1.at(0).at(1)\n';
  });
  await fileRow(editor(page), 'budget.ic').click();

  const sheet = editor(page).getByTestId('typst-spreadsheet');
  await expect(sheet.locator('.ic-root')).toBeVisible();
  // a new workbook is saved at once: the Typst file exists before any edit (the sheet is empty: an error)
  await expect.poll(fileText(page, '/budget.ic.gen.typ')).toContain('"Sheet1": ()');
  await expect(editor(page).getByTestId('typst-status')).not.toHaveText(/✓/);

  // A1 is selected: type into it, Tab to B1, a formula, Enter
  const grid = sheet.locator('canvas').first();
  const box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 32);
  await page.keyboard.type('Rent');
  await page.keyboard.press('Tab');
  await page.keyboard.type('=600*2');
  await page.keyboard.press('Enter');
  await expect.poll(fileText(page, '/budget.ic.gen.typ')).toContain('("Rent", "1200")');
  expect(await fileText(page, '/budget.ic.gen.typ')()).toContain('table.cell(align: right + bottom, "1200")');

  // `values.Sheet1.at(0)` fails on the empty new sheet; with the values in place the document compiles
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
});

/** How light IronCalc's grid is in its middle (0 black … 255 white): its cell background there. */
const gridLightness = (page: Page) => () =>
  editor(page)
    .getByTestId('typst-spreadsheet')
    .locator('canvas')
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const [r, g, b] = canvas.getContext('2d')!.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    });

test('the workbook follows the widget into dark mode and back, its grid included', async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/budget.ic': '' };
  });
  await fileRow(editor(page), 'budget.ic').click();
  const workbook = editor(page).getByTestId('typst-spreadsheet').locator('.ic-root');
  await expect(workbook).toBeVisible();
  await expect.poll(gridLightness(page)).toBeGreaterThan(200);

  // the page turns dark; the widget checks its scheme when the OS one changes
  const switchTo = async (scheme: 'dark' | 'light') => {
    await editor(page).evaluate((el, scheme) => (el.style.colorScheme = scheme), scheme);
    await page.emulateMedia({ colorScheme: scheme });
  };
  await switchTo('dark');
  await expect(editor(page).locator('.typst-editor')).toHaveAttribute('data-scheme', 'dark');
  await expect
    .poll(() => workbook.evaluate((root) => root.style.getPropertyValue('--palette-common-white')))
    .toBe('rgb(13, 17, 23)');
  await expect.poll(gridLightness(page)).toBeLessThan(60);

  await switchTo('light');
  await expect.poll(() => workbook.evaluate((root) => root.style.getPropertyValue('--palette-common-white'))).toBe('');
  await expect.poll(gridLightness(page)).toBeGreaterThan(200);
});
