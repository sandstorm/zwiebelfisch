// The pictures of the feature chapters (docs/20_features/): one test per chapter, named after the chapter's label
// without `features-`, showing what its "What it does" describes, saved as docs/assets/screenshots/<name>.png. Not a
// test suite: it checks only what it waits for before the picture. Run by `mise run docs:screenshots`, which builds
// the demo, starts the playground server for the two room pictures and lists the pictures in
// docs/assets/screenshots/index.typ for `screenshot` in docs/template.typ. Against the demo build, served as for the
// e2e tests (tests/e2e/fixtures.ts). Same pictures on every run: a fixed window, light colors, no motion, fixed users.
import { join, resolve } from 'node:path';
import { expect, type Browser, type BrowserContextOptions, type Locator, type Page } from '@playwright/test';
import { caretAtEnd, clickFirstGlyph, tableBar } from '../e2e/visual-helpers';
import { fileRow, openFile, serve, test } from '../e2e/fixtures';

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

/** A small page, so the preview shows the example large enough beside the editor. */
const PAGE = '#set page(width: 12cm, height: auto, margin: 1cm)\n';

test('visual-editor', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  await shoot(page, 'visual-editor', [editingArea(page)]);
});

test('rendering-preview', async ({ page }) => {
  await open(page, '/');
  await shoot(page, 'rendering-preview');
});

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
  await page.keyboard.type('/');
  await expect(page.locator('[data-testid="typst-suggest"][data-trigger="/"]:visible')).toBeVisible();
  await shoot(page, 'slash-commands', [editingArea(page)]);
});

test('code-blocks', async ({ page }) => {
  await load(page, `${PAGE}Run \`typst compile\` for each document:\n\n\`\`\`sh\nfor n in 1 10 100; do typst compile "doc-$n.typ"; done\n\`\`\`\n`);
  await expect(visual(page).locator('.typst-markup__code-block')).toBeVisible();
  await shoot(page, 'code-blocks');
});

test('images', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/results.typ');
  const image = visual(page).locator('.typst-images__box').first();
  await image.locator('img.typst-visual__rendering').click();
  await expect(image.getByRole('toolbar', { name: 'Image' })).toBeVisible();
  await shoot(page, 'images');
});

test('tables', async ({ page }) => {
  await open(page, '/');
  await hideFiles(page);
  await visual(page).locator('td', { hasText: 'important words' }).click();
  await expect(tableBar(page)).toBeVisible();
  await shoot(page, 'tables', [editingArea(page)]);
});

test('table-of-contents', async ({ page }) => {
  await load(page, [
    PAGE + '#set heading(numbering: "1.1")',
    '#outline(depth: 2)',
    '= Introduction <intro>\nWhy compile times matter.',
    '== Goals\nWhat we measure, and why.',
    '= Method\nHow we measure.',
    '== Setup\nThe machine and the documents.\n',
  ].join('\n\n'));
  await expect(visual(page).locator('h2', { hasText: 'Setup' })).toBeVisible();
  await shoot(page, 'table-of-contents');
});

test('labels-and-references', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/introduction.typ');
  await hideFiles(page);
  await visual(page).locator('.typst-labels__ref[data-target="method"]').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shoot(page, 'labels-and-references', [editingArea(page), page.getByRole('tooltip')]);
});

test('page-layout', async ({ page }) => {
  await load(page, [
    '#set page(paper: "a4", margin: 2.5cm)',
    '#outline()',
    '#pagebreak()',
    '= Introduction\nWriters want to see their document while they type.',
    '#line(length: 100%)\n',
  ].join('\n\n'));
  await expect(visual(page).locator('h1')).toBeVisible();
  await viewMenu(page, 'Page guides');
  await shoot(page, 'page-layout');
});

test('full-typst-support', async ({ page }) => {
  await load(page, `${PAGE}The energy is $E = m c^2$, and\n\n$ sum_(k=1)^n k = (n(n+1)) / 2 $\n\n#rect(fill: aqua)[A box of its own]\n`);
  // the cursor in the last raw box: its code; the others show their pictures
  const box = visual(page).locator('.typst-visual__raw-block').last();
  await box.locator('img.typst-visual__rendering').click();
  await expect(box.locator('.cm-content')).toBeVisible();
  await shoot(page, 'full-typst-support');
});

test('bidirectional-navigation', async ({ page }) => {
  await open(page, '/');
  await clickFirstGlyph(page);
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__highlight').first()).toBeVisible();
  await shoot(page, 'bidirectional-navigation');
});

test('files', async ({ page }) => {
  await open(page, '/?example=advanced');
  for (const folder of ['assets', 'data', 'diagrams']) await fileRow(page, folder).click();
  await openFile(page, 'chapters/method.typ');
  await fileRow(page, 'chapters/method.typ').click({ button: 'right' });
  const menu = page.locator('[role=menu]:visible');
  await expect(menu).toBeVisible();
  await shoot(page, 'files', [page.locator('.typst-editor__side--left'), menu]);
});

test('search-everywhere', async ({ page }) => {
  await open(page, '/?example=advanced');
  await page.getByTestId('typst-search-everywhere').click();
  await page.keyboard.type('compile');
  await expect(page.locator('.typst-quick-pick__heading').first()).toBeVisible();
  await shoot(page, 'search-everywhere');
});

test('help', async ({ page }) => {
  await open(page, '/');
  await page.getByTestId('typst-panel-toggle-help').click();
  const help = page.getByTestId('typst-help');
  await expect(help.getByRole('heading', { name: 'Typst basics' })).toBeVisible();
  await help.getByRole('option').filter({ has: page.locator('code', { hasText: '#table(' }) }).first().click();
  await shoot(page, 'help');
});

test('invisible-characters', async ({ page }) => {
  await load(page, 'Typst  is~fast.\n\nA line broken \\\nby hand.\n');
  await viewMenu(page, 'Invisible characters');
  await expect(visual(page).locator('.typst-invisibles__space').first()).toBeVisible();
  await shoot(page, 'invisible-characters', [visual(page).locator('p')], 24);
});

test('pdf', async ({ page }) => {
  await open(page, '/');
  const pdf = page.getByTestId('typst-pdf');
  await pdf.getByRole('button', { name: 'Download PDF' }).click();
  const options = pdf.getByRole('dialog', { name: 'PDF options' });
  await expect(options).toBeVisible();
  await shoot(page, 'pdf', [page.locator('.typst-editor__side--right'), options]);
});

test('custom-styles', async ({ page }) => {
  await open(page, '/');
  // the caret in the Tip: the text style menu names it, the preview follows to its look
  await caretAtEnd(visual(page).locator('.typst-styles__block.typst-styles--tip p').first());
  await shoot(page, 'custom-styles');
});

test('drawio-diagrams', async ({ page }) => {
  // the picture and its link, not diagrams.net itself (loaded from the internet, never the same twice)
  await page.route('https://embed.diagrams.net/**', (route) => route.abort());
  await open(page, '/');
  await hideFiles(page);
  await visual(page).locator('.typst-images__box img.typst-visual__rendering').first().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await shoot(page, 'drawio-diagrams', [editingArea(page), page.getByRole('tooltip')]);
});

test('spreadsheets', async ({ page }) => {
  await open(page, '/');
  // the caret next to the figure, so the preview shows the table, then the spreadsheet open beside it
  await caretAtEnd(visual(page).locator('p', { hasText: 'in total' }).first());
  await openFile(page, 'data/budget.ic');
  await expect(page.getByTestId('typst-spreadsheet').locator('.ic-root')).toBeVisible();
  await shoot(page, 'spreadsheets');
});

test('mermaid-diagrams', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/method.typ');
  // the caret before the figure, so the preview shows the diagram; the figure's picture in view
  await caretAtEnd(visual(page).locator('p', { hasText: 'shows the loop' }).first());
  const picture = visual(page).locator('img.typst-visual__rendering[alt*="measurement.mmd"]');
  await picture.scrollIntoViewIfNeeded();
  await expect(picture).toBeVisible();
  await shoot(page, 'mermaid-diagrams');
});

test('multi-file-projects', async ({ page }) => {
  await open(page, '/?example=advanced');
  await openFile(page, 'chapters/method.typ');
  await expect(page.locator('nav.typst-file-navigation--top:visible')).toBeVisible();
  await shoot(page, 'multi-file-projects');
});

test('comments', async ({ page }) => {
  await open(page, '/?user=Grace');
  await visual(page).locator('[data-testid="typst-note-marker"][title^="Ada:"]').click();
  await expect(page.getByTestId('typst-note-card')).toBeVisible();
  await shoot(page, 'comments');
});

test('collaborative-editing', async ({ browser, baseURL }) => {
  test.skip(!process.env.TYPST_SCREENSHOTS_SERVER, 'needs the playground server: mise run docs:screenshots starts it');
  const room = `screenshots-${Date.now()}`;
  const ann = await openWindow(browser, baseURL!, `/?room=${room}&user=Ann`);
  const bob = await openWindow(browser, baseURL!, `/?room=${room}&user=Bob`);
  await visual(ann).locator('strong', { hasText: 'stars' }).dblclick();
  await caretAtEnd(visual(bob).locator('h1'));
  await expect(visual(bob).locator('.typst-collaboration__selection[data-user="Ann"]').first()).toBeVisible();
  await shoot(bob, 'collaborative-editing');
});

test('gitlab', async ({ browser, baseURL }) => {
  test.skip(!process.env.TYPST_SCREENSHOTS_SERVER, 'needs the playground server: mise run docs:screenshots starts it');
  const ann = await openWindow(browser, baseURL!, `/?room=${encodeURIComponent(`gitlab:demo/report@screenshots-${Date.now()}`)}&user=Ann`);
  await openFile(ann, 'chapters/introduction.typ');
  await caretAtEnd(visual(ann).locator('p').first());
  await ann.keyboard.type(' Edited in the browser.');
  await expect(ann.locator('.typst-source-control__entry')).toHaveText(/^Not in GitLab/);
  await shoot(ann, 'gitlab');
});

/** Opens the demo at `query` (Local mode unless it names a room) and waits for the first compile. */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(query);
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 60_000 });
}

/** The demo with `main` as its only file (no file panel), compiled. */
async function load(page: Page, main: string): Promise<void> {
  await open(page, '/');
  await page.evaluate((text) => {
    (window as unknown as { editor: { files: Record<string, string> } }).editor.files = { '/main.typ': text };
  }, main);
  await expect(page.getByTestId('typst-files')).toBeHidden();
}

/** A second browser window (another user) at `query`, the same size as the others. */
async function openWindow(browser: Browser, baseURL: string, query: string): Promise<Page> {
  const page = await (await browser.newContext({ ...WINDOW, baseURL })).newPage();
  await serve(page, baseURL);
  await open(page, query);
  await expect(page.getByTestId('typst-visual').first()).toBeVisible();
  return page;
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

/** Switches the View menu's entry `name` on. */
async function viewMenu(page: Page, name: string): Promise<void> {
  await page.getByRole('toolbar', { name: 'Editor actions' }).getByRole('button', { name: 'View', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'View' });
  await menu.getByRole('menuitemcheckbox', { name }).click();
  if (await menu.isVisible()) await page.keyboard.press('Escape');
}

/**
 * Saves the part of the window covering every element `targets` match, `padding` pixels around (default: the whole
 * widget), as docs/assets/screenshots/<name>.png, once the compile, the fonts and the pictures are done.
 */
async function shoot(page: Page, name: string, targets: Locator[] = [page.locator('#editor')], padding = 0): Promise<void> {
  await settle(page);
  const boxes: ({ x: number; y: number; width: number; height: number } | null)[] = [];
  for (const target of targets) {
    for (const element of await target.all()) boxes.push(await element.boundingBox());
  }
  const shown = boxes.filter((box) => box !== null);
  expect(shown.length).toBeGreaterThan(0);
  const { width, height } = page.viewportSize()!;
  const left = Math.max(0, Math.min(...shown.map((box) => box.x)) - padding);
  const top = Math.max(0, Math.min(...shown.map((box) => box.y)) - padding);
  const right = Math.min(width, Math.max(...shown.map((box) => box.x + box.width)) + padding);
  const bottom = Math.min(height, Math.max(...shown.map((box) => box.y + box.height)) + padding);
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
