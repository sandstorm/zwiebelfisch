// The pictures of the feature chapters (docs/20_features/): one test per chapter that shows the editor, named after
// the chapter's label without `features-`, saved as docs/assets/screenshots/<name>.png: only the part of the window
// that shows what its "What it does" describes (chapters about Typst's output show an `example` instead, see
// docs/template.typ). Not a test suite: it checks only what it waits for before the picture. Run by
// `mise run docs:screenshots`, which builds the demo, removes the pictures no test here takes any more and lists the rest in docs/assets/screenshots/index.typ for `screenshot` in
// docs/template.typ. Against the demo build, served as for the e2e tests (tests/e2e/fixtures.ts). Same pictures on
// every run: a fixed window, light colors, no motion, fixed users.
import { join, resolve } from 'node:path';
import { expect, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { caretAtEnd, clickFirstGlyph } from '../e2e/visual-helpers';
import { fileRow, openFile, test } from '../e2e/fixtures';

/** The browser window of every picture. Raise `deviceScaleFactor` for sharper (and about four times larger) files. */
const WINDOW = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
} satisfies BrowserContextOptions;

test.use(WINDOW);

const OUT = resolve(import.meta.dirname, '../../docs/assets/screenshots');

test('source-editor', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.locator('[data-testid=typst-source]:visible .cm-content')).toBeVisible();
  await shoot(page, 'source-editor', [editingArea(page)]);
});

test('styling-and-shortcuts', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  // a selected word: the bar above it offers the marks (bold, italic, …)
  await visual(page).locator('p').first().dblclick();
  await expect(page.locator('.typst-floating-bar:visible').first()).toBeVisible();
  await shoot(page, 'styling-and-shortcuts', [editingArea(page)]);
});

test('slash-commands', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  await caretAtEnd(visual(page).locator('p').first());
  await page.keyboard.press('Enter');
  // filtered to the Insert entries: a list short enough to show whole (the unfiltered one scrolls)
  await page.keyboard.type('/ins');
  const list = page.locator('[data-testid="typst-suggest"][data-trigger="/"]:visible');
  await expect(list).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
  await shoot(page, 'slash-commands', [visual(page).locator('p', { hasText: '/ins' }), list], { padding: 12 });
});

test('images', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/results.typ');
  await hideFiles(page);
  const image = visual(page).locator('.typst-images__box').first();
  await image.locator('img.typst-visual__rendering').click();
  const controls = image.getByRole('toolbar', { name: 'Image' });
  await expect(controls).toBeVisible();
  // the whole box in the window, its controls below it included
  await image.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await shoot(page, 'images', [image, controls], { padding: 12 });
});

test('labels-and-references', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/introduction.typ');
  await hideFiles(page);
  const ref = visual(page).locator('.typst-labels__ref[data-target="method"]');
  await ref.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shoot(page, 'labels-and-references', [visual(page).locator('p', { has: ref }), page.getByRole('tooltip')], { padding: 12 });
});

test('bidirectional-navigation', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  // the heading clicked in the preview, highlighted there, and selected in the Visual editor
  await clickFirstGlyph(page);
  const highlights = page.getByTestId('typst-preview').locator('.typst-preview__highlight');
  await expect(highlights.first()).toBeVisible();
  await shoot(page, 'bidirectional-navigation', [visual(page).locator('h1').first(), highlights], { padding: 24 });
});

test('files', async ({ page }) => {
  await open(page, '/?example=advanced');
  // the panel wider, so the context menu stays inside it
  const grip = (await page.getByRole('separator', { name: 'Left panel width' }).boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 40);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 90, grip.y + 40, { steps: 5 });
  await page.mouse.up();
  for (const folder of ['assets', 'data', 'diagrams']) await fileRow(page, folder).click();
  await openFile(page, 'chapters/method.typ');
  await fileRow(page, 'chapters/method.typ').click({ button: 'right' });
  const menu = page.locator('[role=menu]:visible');
  await expect(menu).toBeVisible();
  await shoot(page, 'files', [page.getByTestId('typst-files').getByRole('treeitem'), menu], { padding: 8 });
});

test('search-everywhere', async ({ page }) => {
  await open(page, '/?example=advanced');
  await page.getByTestId('typst-search-everywhere').click();
  await page.keyboard.type('compile');
  await expect(page.locator('.typst-quick-pick__heading').first()).toBeVisible();
  await shoot(page, 'search-everywhere', [page.locator('.typst-quick-pick:visible')]);
});

test('drawio-diagrams', async ({ page }) => {
  // the picture and its link, not diagrams.net itself (loaded from the internet, never the same twice)
  await page.route('https://embed.diagrams.net/**', (route) => route.abort());
  await open(page, '/');
  await hideFiles(page);
  // the draw.io figure's box, found by its file
  const image = visual(page).locator('.typst-images__box', { has: page.getByRole('button', { name: 'diagrams/editor.drawio.png' }) });
  await image.locator('img.typst-visual__rendering').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shoot(page, 'drawio-diagrams', [image, page.getByRole('tooltip')], { padding: 12 });
});

test('spreadsheets', async ({ page }) => {
  await open(page, '/');
  await openFile(page, 'data/budget.ic');
  const sheet = page.getByTestId('typst-spreadsheet');
  await expect(sheet.locator('.ic-root')).toBeVisible();
  // its toolbars and the budget's rows, not the empty ones below
  await shoot(page, 'spreadsheets', [sheet], { height: 330 });
});

test('multi-file-projects', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/method.typ');
  await hideFiles(page);
  // the links to the previous and the next chapter above the file, and its first heading
  const links = page.locator('nav.typst-file-navigation--top:visible');
  await expect(links).toBeVisible();
  await shoot(page, 'multi-file-projects', [links, visual(page).locator('h1').first()], { padding: 12 });
});

test('comments', async ({ page }) => {
  await open(page, '/?user=Grace');
  const marker = visual(page).locator('[data-testid="typst-note-marker"][title^="Ada:"]');
  await marker.click();
  const card = page.getByTestId('typst-note-card');
  await expect(card).toBeVisible();
  // the commented text with its marker, and the open thread
  await shoot(page, 'comments', [visual(page).locator('p', { has: marker }), card], { padding: 12 });
});

/** Opens the demo at `query` (Local mode unless it names a room) and waits for the first compile. */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(query);
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 60_000 });
}

/** The shown file's Visual editor (each open file keeps one). */
function visual(page: Page): Locator {
  return page.locator('[data-testid=typst-visual]:visible');
}

/** Hides the file panel, so the editing area gets its room. */
async function hideFiles(page: Page): Promise<void> {
  if (await page.getByTestId('typst-files').isVisible()) await page.getByTestId('typst-panel-toggle-files').click();
  await expect(page.getByTestId('typst-files')).toBeHidden();
}

/** The tab bar and the editor of the shown file, without the sides. */
function editingArea(page: Page): Locator {
  return page.locator('.typst-editor__editor-area');
}

/**
 * Saves the part of the window covering every element `targets` match, `padding` pixels around, at most `height`
 * pixels high (from its top), as docs/assets/screenshots/<name>.png, once the compile, the fonts and the pictures are
 * done.
 */
async function shoot(page: Page, name: string, targets: Locator[], { padding = 0, height = Infinity } = {}): Promise<void> {
  await settle(page);
  const boxes: ({ x: number; y: number; width: number; height: number } | null)[] = [];
  for (const target of targets) {
    for (const element of await target.all()) boxes.push(await element.boundingBox());
  }
  const shown = boxes.filter((box) => box !== null);
  expect(shown.length).toBeGreaterThan(0);
  const viewport = page.viewportSize()!;
  const left = Math.max(0, Math.min(...shown.map((box) => box.x)) - padding);
  const top = Math.max(0, Math.min(...shown.map((box) => box.y)) - padding);
  const right = Math.min(viewport.width, Math.max(...shown.map((box) => box.x + box.width)) + padding);
  const bottom = Math.min(viewport.height, top + height, Math.max(...shown.map((box) => box.y + box.height)) + padding);
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: { x: left, y: top, width: right - left, height: bottom - top },
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Waits until nothing changes any more: compiled, the fonts loaded, every picture in the widget decoded. */
async function settle(page: Page): Promise<void> {
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() => page.locator('#editor img:visible').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete)))
    .toBe(true);
  // the raw boxes' pictures of the last compile, the preview scrolled to the cursor
  await page.waitForTimeout(800);
}
