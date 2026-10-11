// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root, and the demo): a
// spreadsheet (.ic) edited in IronCalc's workbook UI, imported by Typst through its generated Typst file, whose path leads to it.
import { readFileSync } from 'node:fs';
import init, { Model } from '@ironcalc/wasm';
import { expect, type Page } from '@playwright/test';
import { test, fileRow, openFile } from './fixtures';

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

test("a spreadsheet's named cells and ranges reach Typst as `names` and `name-values`, updated on every edit", async ({ page }) => {
  // the spreadsheet is built here with IronCalc's engine: A1 a cost, B1 its double (named `Total`), A1:B1 named `Costs`
  await init({ module_or_path: readFileSync(new URL('../../node_modules/@ironcalc/wasm/wasm_bg.wasm', import.meta.url)) });
  const model = new Model('budget', 'en', 'UTC', 'en');
  model.setUserInput(0, 1, 1, '10');
  model.setUserInput(0, 1, 2, '=A1*2');
  model.newDefinedName('Total', undefined, 'Sheet1!$B$1');
  model.newDefinedName('Costs', undefined, 'Sheet1!$A$1:$B$1');
  model.evaluate();
  const bytes = [...model.toBytes()];
  model.free();

  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor, bytes) => {
    el.files = { '/budget.ic': new Uint8Array(bytes) };
    el.value = '#import "budget.ic.gen.typ": names, name-values\n\n#figure(names.Costs)\nTotal: #names.Total, #name-values.Costs.at(0).at(0)\n';
  }, bytes);
  await fileRow(editor(page), 'budget.ic').click();
  const sheet = editor(page).getByTestId('typst-spreadsheet');
  await expect(sheet.locator('.ic-root')).toBeVisible();

  // A1 is selected: a new cost; the Typst file follows (it is written on the first edit)
  const box = (await sheet.locator('canvas').first().boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 32);
  await page.keyboard.type('21');
  await page.keyboard.press('Enter');
  await expect.poll(fileText(page, '/budget.ic.gen.typ')).toContain('#let names = (\n  "Total": "42",\n  "Costs": table(');
  expect(await fileText(page, '/budget.ic.gen.typ')()).toContain('#let name-values = (\n  "Total": "42",\n  "Costs": (\n    ("21", "42"),\n  ),\n)');
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

  // the example's "Dark" checkbox sets the setting `workbench.theme` (the example fixes it to light otherwise)
  const switchTo = (scheme: 'dark' | 'light') => page.getByTestId('dark').setChecked(scheme === 'dark');
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

test('⌘/Ctrl+click on the path of a spreadsheet\'s Typst file ("Edit spreadsheet") opens the spreadsheet, not the generated file', async ({ page }) => {
  await page.goto('/?example=advanced');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await openFile(page, 'chapters/results.typ');
  // the import line's raw box in the Visual editor
  const path = page.locator('[data-testid=typst-visual]:visible .typst-visual__raw-block .typst-source__path', { hasText: 'compile-times.ic.gen.typ' });
  await path.hover();
  await expect(page.locator('.cm-tooltip')).toContainText('Edit spreadsheet');
  await path.click({ modifiers: ['ControlOrMeta'] });
  await expect(fileRow(page, 'data/compile-times.ic')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('typst-spreadsheet').locator('.ic-root')).toBeVisible();
});
