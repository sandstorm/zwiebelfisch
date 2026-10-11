// End-to-end tests (Playwright, against the demo build): the Visual editor's toolbar.
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { caretAtEnd, chooseFrom, compiled, freshSelectedLine, selectionBar, selectText, sourceText, toolbar, visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

async function source(page: Page) {
  await page.getByRole('tab', { name: 'Source' }).click();
  return page.getByTestId('typst-source');
}

test('Bold button wraps the selection in *…*', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Bold' }).click();
  await expect(selectionBar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await expect(await source(page)).toContainText('*Fresh line*');
});

test('a text selection gets a floating bar above it; its Italic formats the selection', async ({ page }) => {
  const bubble = selectionBar(page);
  await expect(bubble).toBeHidden();
  await freshSelectedLine(page);
  await expect(bubble).toBeVisible();
  const [bar, line] = await Promise.all([bubble.boundingBox(), visual(page).locator('p', { hasText: 'Fresh line' }).boundingBox()]);
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(line!.y + 2); // above the selected line
  await bubble.getByRole('button', { name: 'Italic' }).click();
  await expect(await source(page)).toContainText('_Fresh line_');
});

test('Italic button wraps the selection in _…_', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Italic' }).click();
  await expect(await source(page)).toContainText('_Fresh line_');
});

test('Underline button wraps the selection in #underline[…], shown underlined', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Underline' }).click();
  await expect(selectionBar(page).getByRole('button', { name: 'Underline' })).toHaveAttribute('aria-pressed', 'true');
  await expect(visual(page).locator('u', { hasText: 'Fresh line' })).toBeVisible();
  await expect(await source(page)).toContainText('#underline[Fresh line]');
});

test('Ctrl+U (⌘U on Mac) underlines the selection, inside bold', async ({ page }) => {
  await freshSelectedLine(page);
  await page.keyboard.press('ControlOrMeta+B');
  await page.keyboard.press('ControlOrMeta+U');
  await expect(await source(page)).toContainText('*#underline[Fresh line]*');
});

test('Strikethrough button wraps the selection in #strike[…], shown struck through', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Strikethrough' }).click();
  await expect(selectionBar(page).getByRole('button', { name: 'Strikethrough' })).toHaveAttribute('aria-pressed', 'true');
  await expect(visual(page).locator('s', { hasText: 'Fresh line' })).toBeVisible();
  await expect(await source(page)).toContainText('#strike[Fresh line]');
});

test('Highlight button wraps the selection in #highlight[…], shown with a background', async ({ page }) => {
  await freshSelectedLine(page);
  await selectionBar(page).getByRole('button', { name: 'Highlight' }).click();
  await expect(selectionBar(page).getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true');
  const mark = visual(page).locator('mark', { hasText: 'Fresh line' });
  await expect(mark).toBeVisible();
  expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await expect(await source(page)).toContainText('#highlight[Fresh line]');
});

test('Ctrl+Shift+S and Ctrl+Shift+H (⌘⇧S, ⌘⇧H on Mac) strike and highlight the selection, inside underline', async ({ page }) => {
  await freshSelectedLine(page);
  await page.keyboard.press('ControlOrMeta+U');
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await page.keyboard.press('ControlOrMeta+Shift+H');
  await expect(await source(page)).toContainText('#underline[#strike[#highlight[Fresh line]]]');
});

for (const [label, prefix] of [['Heading 1', '= '], ['Heading 2', '== '], ['Heading 3', '=== ']] as const) {
  test(`text style "${label}" makes the line a ${prefix.trim()} heading`, async ({ page }) => {
    await freshSelectedLine(page);
    await toolbar(page).getByLabel('Text style').selectOption({ label });
    await expect(await source(page)).toContainText(`${prefix}Fresh line`);
  });
}

test('text style "Normal text" turns a heading back into a paragraph', async ({ page }) => {
  await caretAtEnd(visual(page).locator('h1'));
  await toolbar(page).getByLabel('Text style').selectOption({ label: 'Normal text' });
  const src = await source(page);
  await expect(src).not.toContainText('= Typst in five minutes');
  await expect(src).toContainText('Typst in five minutes');
});

test('Bulleted list button makes a - item', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Bulleted list' }).click();
  await expect(await source(page)).toContainText('- Fresh line');
});

test('Numbered list button makes a + item', async ({ page }) => {
  await freshSelectedLine(page);
  await toolbar(page).getByRole('button', { name: 'Numbered list' }).click();
  await expect(await source(page)).toContainText('+ Fresh line');
});

test('Undo and Redo buttons revert and reapply an edit', async ({ page }) => {
  await freshSelectedLine(page);
  const bar = toolbar(page);
  await selectionBar(page).getByRole('button', { name: 'Bold' }).click();
  await bar.getByRole('button', { name: 'Undo' }).click();
  await expect(visual(page).locator('strong', { hasText: 'Fresh line' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Redo' }).click();
  await expect(await source(page)).toContainText('*Fresh line*');
});

test('raw blocks are editable in place and change only their source', async ({ page }) => {
  const box = visual(page).locator('.typst-visual__raw-block').first();
  await box.locator('.cm-content').click();
  // not End on the first line: the box wraps long lines, and End stops at the wrap point
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('#set par(justify: true)\n');
  await expect.poll(sourceText(page)).toMatch(/^#set par\(justify: true\)\n#import "@preview\/drafting:0\.2\.2"/);
});

test('arrow down on the last line of a raw block moves into the next block', async ({ page }) => {
  // the demo's first raw block (imports, set and show rules) ends in the `)` of #set-margin-note-defaults
  await visual(page).locator('.typst-visual__raw-block').first().locator('.cm-line').last().click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('X');
  await expect(visual(page).locator('h1')).toHaveText('XTypst in five minutes');
});

test("the selection bar's Styles menu toggles the simple example's inline style Key on the selected word", async ({ page }) => {
  const paragraph = visual(page).locator('p', { hasText: 'Typst is a markup language' });
  await selectText(paragraph, 'markup');
  await chooseFrom(selectionBar(page), 'Styles', 'Key');
  await expect.poll(sourceText(page)).toContain('Typst is a #key[markup] language');
  await expect(paragraph.locator('.typst-styles__inline')).toHaveText('markup');
  await selectText(paragraph.locator('.typst-styles__inline'), 'markup');
  await selectionBar(page).getByRole('button', { name: 'Styles', exact: true }).click();
  const key = selectionBar(page).getByRole('menuitem', { name: 'Key', exact: true });
  await expect(key).toHaveAttribute('aria-pressed', 'true');
  await key.click();
  await expect.poll(sourceText(page)).toContain('Typst is a markup language');
});
