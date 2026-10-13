// End-to-end tests (Playwright, against the demo build): inline raw boxes sit on their text line,
// one line high, as code and as compiled snippets, in paragraphs and table cells; edited, only their code shows.
import { expect, type Locator, type Page } from '@playwright/test';
import { test } from './fixtures';

type Editor = HTMLElement & { value: string };

const visual = (page: Page) => page.locator('[data-testid=typst-visual]:visible');

/** The box's height and the line height of the text block around it (px). */
async function heights(box: Locator): Promise<{ box: number; line: number; block: number }> {
  return box.evaluate((element) => {
    const block = element.closest('p, li, td, th') as HTMLElement;
    const style = getComputedStyle(block);
    const line = parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize);
    return { box: element.getBoundingClientRect().height, line, block: block.getBoundingClientRect().height };
  });
}

/** A box no taller than its line, in a block of one line (padding of a table cell aside). */
async function expectOneLine(box: Locator): Promise<void> {
  await expect(box).toBeVisible();
  const { box: height, line, block } = await heights(box);
  expect(height).toBeLessThanOrEqual(line * 1.1);
  expect(block).toBeLessThan(line * 1.6 + 8);
}

test.describe('the advanced example: the timings table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?example=advanced#/chapters/results.typ');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  });

  test('an expression cell (ms(6)) is one line high, like the text cells beside it', async ({ page }) => {
    const figure = visual(page).locator('figure').filter({ has: page.locator('table') });
    const row = figure.locator('tr').filter({ hasText: '15.8×' });
    // [10], ms(95), ms(6), [15.8×]: the third cell holds ms(6)
    const box = row.locator('td').nth(2).locator('.typst-visual__raw-inline');
    await expectOneLine(box);
    const textCell = await row.locator('td').last().locator('p').boundingBox();
    const boxCell = await row.locator('td').nth(2).locator('p').boundingBox();
    expect(Math.abs(boxCell!.height - textCell!.height)).toBeLessThanOrEqual(2);
  });

  test('while edited, the box stays one line high', async ({ page }) => {
    const figure = visual(page).locator('figure').filter({ has: page.locator('table') });
    const box = figure.locator('td .typst-visual__raw-inline').first();
    await box.click();
    await expect(box.locator('.cm-editor')).toHaveClass(/cm-focused/);
    await expectOneLine(box);
  });
});

test.describe('in a paragraph (plain page, boxes rendered)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/plain-html/');
    await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  });

  const load = (page: Page, value: string) => page.locator('zwiebelfisch-editor').evaluate((el: Editor, value) => (el.value = value), value);

  test('inline code that is not compiled is a one-line chip', async ({ page }) => {
    // as in the advanced example: what `ms` draws comes from its definition, so there is no snippet of the call
    await load(page, '#let ms(v) = [#v ms]\n\nIt took #ms(6) only.\n');
    await expectOneLine(page.getByTestId('typst-visual').locator('p .typst-visual__raw-inline'));
  });

  test('a compiled inline snippet is one line high, its text about the size of the text around it', async ({ page }) => {
    await load(page, 'Take #text(red)[this] and that.\n');
    const box = page.getByTestId('typst-visual').locator('p .typst-visual__raw-inline');
    const picture = box.locator('img.typst-visual__rendering');
    await expect(picture).toBeVisible();
    await expectOneLine(picture);
    const { box: height, line } = await heights(picture);
    // the snippet is one line of text plus a little padding: not shrunk to a sliver either
    expect(height).toBeGreaterThan(line * 0.7);
  });
});

/** The inline box of `src` in the shown Visual editor, edited: only its code shows; Escape: only its picture again. */
async function expectCodeReplacesPicture(page: Page, src: string): Promise<void> {
  const pictureOfSrc = `img.typst-visual__rendering[alt="${src}"]`;
  const picture = visual(page).locator(`p .typst-visual__raw-inline > ${pictureOfSrc}`);
  // `has` looks inside each box: a locator relative to it, not one starting from the editor
  const box = visual(page).locator('p .typst-visual__raw-inline').filter({ has: page.locator(pictureOfSrc) });
  const code = box.locator('.typst-visual__code');
  await expect(picture).toBeVisible();
  await expect(code).toBeHidden();

  await picture.click();
  await expect(box.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await expect(code).toBeVisible();
  await expect(picture).toBeHidden();
  // its paragraph wraps: the box alone is one line high
  const { box: height, line } = await heights(box);
  expect(height).toBeLessThanOrEqual(line * 1.1);

  await page.keyboard.press('Escape');
  await expect(picture).toBeVisible();
  await expect(code).toBeHidden();
}

test.describe('an inline equation being edited shows only its code, as a block box does', () => {
  test('the simple example: $a^2 + b^2 = c^2$', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
    await expectCodeReplacesPicture(page, '$a^2 + b^2 = c^2$');
  });

  test('the advanced example: $tilde(t)$', async ({ page }) => {
    await page.goto('/?example=advanced#/chapters/method.typ');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
    await expectCodeReplacesPicture(page, '$tilde(t)$');
  });
});
