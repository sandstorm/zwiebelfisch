// End-to-end tests (Playwright, against the demo build): preview zoom, page numbers and reveal.
import { expect, type Page } from '@playwright/test';
import { test, clickGlyph } from './fixtures';

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

const scroller = (page: Page) => page.locator('.zwf-preview__scroller');
const pages = (page: Page) => page.getByTestId('zwf-preview').locator('.zwf-preview__page');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(pages(page).locator('svg').first()).toBeVisible();
});

test('zooms in, out, to 100% and back to fit width', async ({ page }) => {
  const toolbar = page.getByTestId('zwf-preview-toolbar');
  const zoom = page.getByTestId('zwf-preview-zoom');
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
  await page.getByTestId('zwf-preview-toolbar').getByRole('button', { name: 'Zoom in' }).click();
  await clickGlyph(pages(page).locator('svg use').first());
  await expect(page.getByTestId('zwf-source').locator('.zwf-source__jump')).toHaveText('Typst in five minutes');
});

test('highlights the clicked text in the preview', async ({ page }) => {
  await clickGlyph(pages(page).locator('svg use').first());
  // every place the clicked text is drawn: the heading, and its entry in the demo's outline
  const highlights = pages(page).first().locator('.zwf-preview-sync__click');
  await expect(highlights.first()).toBeVisible();
  const boxes = await highlights.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as DOMRect));
  // the glyph's origin, not its bounding box: Firefox reports a size-less <use> as large as the page
  const origin = await pages(page).locator('svg use').first().evaluate((use: SVGUseElement) => {
    const local = new DOMPoint(use.x.baseVal.value + 3, use.y.baseVal.value);
    return local.matrixTransform((use.parentNode as SVGGraphicsElement).getScreenCTM()!).x;
  });
  expect(boxes.some((box) => box.x <= origin && box.x + box.width > origin)).toBe(true);
  // regression: the outline must be the clicked text, never the whole page
  const pageBox = (await pages(page).first().boundingBox())!;
  for (const box of boxes) {
    expect(box.height).toBeLessThan(pageBox.height / 4);
    expect(box.width).toBeLessThan(pageBox.width * 0.9);
  }
});

test("a double click's highlights go with the next edit or once the selection moves, in either editor", async ({ page }) => {
  // the heading's outline, the first of its highlights (its entry in the demo's outline has one, too)
  const outline = pages(page).first().locator('.zwf-preview-sync__click');
  const jump = page.getByTestId('zwf-source').locator('.zwf-source__jump');
  const heading = pages(page).locator('svg use').first();

  // Source editor: an edit removes the outline in the preview and the highlight in the source
  await page.getByRole('tab', { name: 'Source' }).click();
  await clickGlyph(heading, { clickCount: 2 });
  await expect(jump).toHaveText('Typst in five minutes');
  await expect(outline.first()).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(jump).toHaveCount(0);
  await expect(outline).toHaveCount(0);

  // Visual editor: moving the selection away removes the outline; so does an edit
  await page.getByRole('tab', { name: 'Visual' }).click();
  await clickGlyph(heading, { clickCount: 2 });
  await expect(outline.first()).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(outline).toHaveCount(0);
  await clickGlyph(heading, { clickCount: 2 });
  await expect(outline.first()).toBeVisible();
  await page.keyboard.type('?');
  await expect(outline).toHaveCount(0);
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
    await expect(page.getByTestId('zwf-preview-page-number')).toHaveText('1 / 30');

    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(page.getByTestId('zwf-preview-page-number')).toHaveText('30 / 30');
    await expect(pages(page).last().locator('svg')).toBeVisible();
    await expect(pages(page).first().locator('svg')).toHaveCount(0);
  });

  test('stays responsive while typing', async ({ page }) => {
    await page.getByTestId('zwf-source').locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const typed = 'Typing into a long document stays fast. ';
    const started = Date.now();
    await page.keyboard.type(typed, { delay: 20 });
    // the keystrokes reached the editor without waiting for compilations to finish
    expect(Date.now() - started).toBeLessThan(typed.length * 20 + 3000);
    await expect(page.getByTestId('zwf-source')).toContainText(typed.trim());
    // the preview caught up and still shows all pages, the first one rendered
    await expect(pages(page)).toHaveCount(30);
    await expect(pages(page).first().locator('svg')).toBeVisible();
    await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
  });

  test('moving the cursor scrolls the preview only when the target is off-screen', async ({ page }) => {
    const source = page.getByTestId('zwf-source').locator('.cm-content');
    await source.getByText('Text of page 1.', { exact: false }).first().click();
    await page.waitForTimeout(500);
    expect(await scroller(page).evaluate((el) => el.scrollTop)).toBe(0);

    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('ArrowUp'); // into the text of the last page
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
    await expect(page.getByTestId('zwf-preview-page-number')).toHaveText('30 / 30');
  });
});

test('dragging the separator between editor and preview resizes both', async ({ page }) => {
  const preview = page.getByTestId('zwf-preview');
  const editingArea = page.locator('.zwf-editor__editor-area');
  const before = (await preview.boundingBox())!;
  const editingBefore = (await editingArea.boundingBox())!;
  const split = page.getByRole('separator', { name: 'Right panel width' });
  const box = (await split.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // to the right: the preview narrows (to the left it may not grow far: the editing area keeps a minimum width
  // beside the demo's file panel)
  await page.mouse.move(box.x + 150, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await preview.boundingBox())!;
  expect(after.width).toBeLessThan(before.width - 100);
  expect((await editingArea.boundingBox())!.width).toBeGreaterThan(editingBefore.width + 100);
});

test("the preview's rail button hides the right side (the editor takes its room); hidden, it keeps compiling", async ({ page }) => {
  const editingArea = page.locator('.zwf-editor__editor-area');
  const before = (await editingArea.boundingBox())!.width;
  const toggle = page.getByTestId('zwf-panel-toggle-preview');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.getByTestId('zwf-preview')).toBeHidden();
  expect((await editingArea.boundingBox())!.width).toBeGreaterThan(before + 200);
  await setSource(page, '= Hidden\n\n#unknown-function()\n');
  await expect(page.getByTestId('zwf-status')).not.toHaveText(/✓ compiled/);
  await setSource(page, '= Shown again\n');
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
  await page.reload();
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
  await expect(page.getByTestId('zwf-preview')).toBeHidden(); // remembered for the session
  await page.getByTestId('zwf-panel-toggle-preview').click();
  await expect(pages(page).locator('svg').first()).toBeVisible();
});
