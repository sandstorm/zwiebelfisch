// End-to-end tests (Playwright, against the demo build): preview zoom, page numbers and reveal.
import type { Page } from '@playwright/test';
import { test, expect, clickGlyph } from './fixtures';

/** A document of `count` fixed-size pages, each with a heading and a paragraph. */
function longDocument(count: number): string {
  const pages = Array.from(
    { length: count },
    (_, i) => `= Section ${i + 1}\n\nText of page ${i + 1}. ${'Lorem ipsum dolor sit amet. '.repeat(20)}`,
  );
  return `#set page(width: 12cm, height: 16cm)\n\n${pages.join('\n\n#pagebreak()\n\n')}\n`;
}

async function setSource(page: Page, source: string) {
  await page.evaluate((text) => ((window as unknown as { editor: { source: string } }).editor.source = text), source);
}

const scroller = (page: Page) => page.locator('.typst-preview__scroller');
const pages = (page: Page) => page.getByTestId('typst-preview').locator('.typst-preview__page');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(pages(page).locator('svg').first()).toBeVisible();
});

test('zooms in, out, to 100% and back to fit width', async ({ page }) => {
  const toolbar = page.getByTestId('typst-preview-toolbar');
  const zoom = page.getByTestId('typst-preview-zoom');
  const width = () => pages(page).first().evaluate((el) => el.getBoundingClientRect().width);
  const fitWidth = await width();
  await expect(zoom).toHaveText(/^Fit · \d+%$/);

  await toolbar.getByRole('button', { name: 'Actual size' }).click();
  await expect(zoom).toHaveText('100%');
  // the demo page is 16cm wide: 16 / 2.54 × 96 px
  expect(await width()).toBeCloseTo((16 / 2.54) * 96, 0);

  await toolbar.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoom).toHaveText('125%');
  await toolbar.getByRole('button', { name: 'Zoom out' }).click();
  await toolbar.getByRole('button', { name: 'Zoom out' }).click();
  await expect(zoom).toHaveText('75%');

  await toolbar.getByRole('button', { name: 'Fit width' }).click();
  await expect(zoom).toHaveText(/^Fit/);
  expect(await width()).toBeCloseTo(fitWidth, 0);
});

test('clicking keeps working when zoomed in', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  await page.getByTestId('typst-preview-toolbar').getByRole('button', { name: 'Zoom in' }).click();
  await clickGlyph(pages(page).locator('svg use').first());
  await expect(page.getByTestId('typst-source').locator('.typst-source__jump')).toHaveText('Hello Typst');
});

test('highlights the clicked text in the preview', async ({ page }) => {
  await clickGlyph(pages(page).locator('svg use').first());
  const highlight = pages(page).first().locator('.typst-preview__highlight');
  await expect(highlight).toBeVisible();
  const box = (await highlight.boundingBox())!;
  const glyph = (await pages(page).locator('svg use').first().boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(glyph.x + 1);
  expect(box.x + box.width).toBeGreaterThan(glyph.x + glyph.width - 1);
  // regression: the outline must be the clicked text, never the whole page
  const pageBox = (await pages(page).first().boundingBox())!;
  expect(box.height).toBeLessThan(pageBox.height / 4);
  expect(box.width).toBeLessThan(pageBox.width * 0.9);
});

test.describe('a 30-page document', () => {
  test.beforeEach(async ({ page }) => {
    await page.getByRole('tab', { name: 'Source' }).click();
    await setSource(page, longDocument(30));
    await expect(pages(page)).toHaveCount(30);
  });

  test('renders SVG only for pages near the viewport and shows page numbers', async ({ page }) => {
    const rendered = await pages(page).locator('svg').count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(10);
    await expect(page.getByTestId('typst-preview-page-number')).toHaveText('1 / 30');

    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId('typst-preview-page-number')).toHaveText('30 / 30');
    await expect(pages(page).last().locator('svg')).toBeVisible();
    await expect(pages(page).first().locator('svg')).toHaveCount(0);
  });

  test('stays responsive while typing', async ({ page }) => {
    await page.getByTestId('typst-source').locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const typed = 'Typing into a long document stays fast. ';
    const started = Date.now();
    await page.keyboard.type(typed, { delay: 20 });
    // the keystrokes reached the editor without waiting for compilations to finish
    expect(Date.now() - started).toBeLessThan(typed.length * 20 + 3000);
    await expect(page.getByTestId('typst-source')).toContainText(typed.trim());
    // the preview caught up and still shows all pages, the first one rendered
    await expect(pages(page)).toHaveCount(30);
    await expect(pages(page).first().locator('svg')).toBeVisible();
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  });

  test('moving the cursor scrolls the preview only when the target is off-screen', async ({ page }) => {
    const source = page.getByTestId('typst-source').locator('.cm-content');
    await source.getByText('Text of page 1.', { exact: false }).first().click();
    await page.waitForTimeout(500);
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBe(0);

    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ArrowUp'); // into the text of the last page
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    await expect(page.getByTestId('typst-preview-page-number')).toHaveText('30 / 30');
  });
});
