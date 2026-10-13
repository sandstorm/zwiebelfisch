// End-to-end tests (Playwright, against the demo build): references and web links followed with ⌘/Ctrl+click, in the
// Visual and the Source editor, as file links are.
import { expect, type Page } from '@playwright/test';
import { test, fileRow, openFile } from './fixtures';

type Editor = HTMLElement & { value: string };

const visual = (page: Page) => page.locator('[data-testid="typst-visual"]:visible');
/** The hover hint of the link under the pointer: the same in every editor. */
const hint = (page: Page) => page.getByRole('tooltip');

test.describe('in the advanced example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?example=advanced');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
    await openFile(page, 'chapters/introduction.typ');
  });

  test('a reference chip says where it leads (the hint of every link); ⌘/Ctrl+click opens the chapter with the figure, a plain click does not', async ({ page }) => {
    const chip = visual(page).locator('.typst-labels__ref[data-target="fig:compile-times"]');
    await chip.hover();
    await expect(hint(page)).toHaveClass('typst-link-hint');
    await expect(hint(page)).toHaveText(/^Go to Figure · Cold \(dark\) and incremental \(light\)… in chapters\/results\.typ\s*\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    await expect(chip).toHaveAttribute('aria-describedby', (await hint(page).getAttribute('id'))!);
    await expect(chip).not.toHaveAttribute('title');
    await chip.click();
    await expect(fileRow(page, 'chapters/introduction.typ')).toHaveAttribute('aria-selected', 'true');
    await chip.click({ modifiers: ['ControlOrMeta'] });
    await expect(fileRow(page, 'chapters/results.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(visual(page).locator('h1')).toHaveText(/Results/);
  });

  test('in the Source editor, a reference shows the same hint; ⌘/Ctrl+click puts the cursor at the label in its chapter', async ({ page }) => {
    await page.getByRole('tab', { name: 'Source' }).click();
    const source = page.locator('[data-testid=typst-source]:visible');
    const reference = source.locator('.typst-source__path', { hasText: '@fig:compile-times' });
    await reference.hover();
    await expect(hint(page)).toHaveClass('typst-link-hint');
    await expect(hint(page)).toHaveText(/^Go to Figure · Cold \(dark\) and incremental \(light\)… in chapters\/results\.typ\s*\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    await reference.click({ modifiers: ['ControlOrMeta'] });
    await expect(fileRow(page, 'chapters/results.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(source.locator('.cm-activeLine')).toContainText('<fig:compile-times>');
  });
});

test.describe('references to sections in the documentation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?example=docs');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  });

  /** A section's heading (`==`), or a chapter's (`=`): a file's top level shows as `h1`. */
  const heading = (page: Page, level: 'h1' | 'h2', text: string) => visual(page).locator(level, { hasText: text });

  test('⌘/Ctrl+click on a reference to a section far down the same file (opened from the file panel) scrolls there', async ({ page }) => {
    await openFile(page, '30_configuration/01_options.typ');
    const chip = visual(page).locator('.typst-labels__ref[data-target="configuration-options-editor"]').first();
    await chip.hover();
    await expect(hint(page)).toHaveText(/^Go to Section · Editor options in 30_configuration\/01_options\.typ\s*\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    await expect(heading(page, 'h2', 'Editor options')).not.toBeInViewport();
    await chip.click({ modifiers: ['ControlOrMeta'] });
    await expect(heading(page, 'h2', 'Editor options')).toBeInViewport();
    await expect(fileRow(page, '30_configuration/01_options.typ')).toHaveAttribute('aria-selected', 'true');
  });

  test('⌘/Ctrl+click on a reference to a chapter in another file opens it there; so does Alt+Enter', async ({ page }) => {
    await openFile(page, '10_getting-started/01_getting-started.typ');
    const chip = visual(page).locator('.typst-labels__ref[data-target="features-mermaid-diagrams"]').first();
    await chip.click({ modifiers: ['ControlOrMeta'] });
    await expect(fileRow(page, '20_features/09_mermaid-diagrams.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page, 'h1', 'Mermaid diagrams')).toBeInViewport();

    await openFile(page, '10_getting-started/01_getting-started.typ');
    await visual(page).locator('.typst-labels__ref[data-target="features-spreadsheets"]').first().click();
    await page.keyboard.press('Alt+Enter');
    await expect(fileRow(page, '20_features/08_spreadsheets.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(heading(page, 'h1', 'Spreadsheets')).toBeInViewport();
  });
});

test('⌘/Ctrl+click on a web link opens its address in a new tab; a plain click edits', async ({ page }) => {
  await page.context().route('https://typst.app/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Typst</title>' }));
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await page.locator('typst-editor').evaluate((el: Editor) => {
    el.value = 'Made with #link("https://typst.app/")[Typst].\n';
  });
  const link = visual(page).locator('.typst-markup__link');
  await link.hover();
  await expect(hint(page)).toHaveText(/^Open https:\/\/typst\.app\/\s*\(/);
  await expect(link).not.toHaveAttribute('title');
  await page.mouse.move(0, 0);
  await expect(hint(page)).toHaveCount(0);
  await link.click();
  expect(page.context().pages()).toHaveLength(1);
  const opened = page.context().waitForEvent('page');
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect((await opened)).toHaveURL('https://typst.app/');
});
