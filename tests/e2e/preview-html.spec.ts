// End-to-end tests (Playwright, against the demo build): the preview's "Pages | HTML" switch and the HTML preview
// (previewHtml): Typst's HTML export in a sandboxed frame, page by page, following the cursor, links between pages,
// the scroll position kept across compiles.
import { expect, type FrameLocator, type Page } from '@playwright/test';
import { test } from './fixtures';

/** A bundle of two pages; the second is long, so it scrolls. */
const SITE = [
  '#document("index.html", title: "Home")[',
  '  = Home',
  '  #link("two.html#end")[To the end of two]',
  '  #link("https://typst.app")[Typst]',
  ']',
  '#document("two.html", title: "Two")[',
  '  = Two',
  `  ${Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n  ')}`,
  '',
  '  == The end <end>',
  '  Last words.',
  ']',
].join('\n');

const setSource = (page: Page, text: string) => page.evaluate((t) => ((window as unknown as { editor: { source: string } }).editor.source = t), text);
const html = (page: Page): FrameLocator => page.frameLocator('[data-testid="typst-preview-html"]');
const switchTo = (page: Page, name: 'Pages' | 'HTML') => page.getByTestId('typst-preview-renderers').getByRole('button', { name }).click();
/** How far the frame's page is scrolled. */
const scrollY = (page: Page) => html(page).locator('html').evaluate((element) => element.ownerDocument.defaultView!.scrollY);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg').first()).toBeVisible();
});

test('switches to HTML and back: zoom and page number only with the pages, the choice remembered', async ({ page }) => {
  const switcher = page.getByTestId('typst-preview-renderers');
  await expect(switcher.getByRole('button', { name: 'Pages' })).toHaveAttribute('aria-pressed', 'true');
  await switchTo(page, 'HTML');
  await expect(switcher.getByRole('button', { name: 'HTML' })).toHaveAttribute('aria-pressed', 'true');
  await expect(html(page).locator('h1, h2').first()).toBeVisible();
  await expect(page.getByTestId('typst-preview')).toBeHidden();
  await expect(page.getByTestId('typst-preview-zoom')).toBeHidden();
  await expect(page.getByTestId('typst-preview-page-number')).toBeHidden();
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);

  await page.reload();
  await expect(html(page).locator('h1, h2').first()).toBeVisible();
  await switchTo(page, 'Pages');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg').first()).toBeVisible();
  await expect(page.getByTestId('typst-preview-zoom')).toBeVisible();
});

test('shows a bundle page by page: links switch pages, URLs open a new tab', async ({ page, context }) => {
  await switchTo(page, 'HTML');
  await setSource(page, SITE);
  await expect(html(page).locator('h2')).toHaveText('Home');
  await html(page).getByRole('link', { name: 'To the end of two' }).click();
  await expect(html(page).locator('h2').first()).toHaveText('Two');
  await expect(html(page).getByText('Last words.')).toBeInViewport();
  // back to index.html through the cursor (the end of the line `= Home`), then out to the web
  await page.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(html(page).locator('h2')).toHaveText('Home');
  const opened = context.waitForEvent('page');
  await html(page).getByRole('link', { name: 'Typst' }).click();
  expect((await opened).url()).toContain('typst.app');
  // the frame itself never navigates
  await expect(html(page).locator('h2')).toHaveText('Home');
});

test('follows the cursor to the page and element its text made; a compile keeps the scroll position', async ({ page }) => {
  await switchTo(page, 'HTML');
  await setSource(page, SITE);
  await expect(html(page).locator('h2')).toHaveText('Home');
  const source = page.getByTestId('typst-source').locator('.cm-content');
  await source.getByText('Last words.').click();
  await expect(html(page).getByText('Last words.')).toBeInViewport();
  const scrolled = await scrollY(page);
  expect(scrolled).toBeGreaterThan(0);
  // typing on the page keeps it where it is
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await expect(html(page).getByText('Last words. More.')).toBeVisible();
  expect(Math.abs((await scrollY(page)) - scrolled)).toBeLessThan(40);
});
