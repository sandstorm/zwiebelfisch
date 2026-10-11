// End-to-end tests (Playwright, against the demo build): references and web links followed with ⌘/Ctrl+click, in the
// Visual and the Source editor, as file links are.
import { expect, type Page } from '@playwright/test';
import { test, fileRow, openFile } from './fixtures';

type Editor = HTMLElement & { value: string };

const visual = (page: Page) => page.locator('[data-testid="typst-visual"]:visible');

test.describe('in the advanced example', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?example=advanced');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
    await openFile(page, 'chapters/introduction.typ');
  });

  test('a reference chip says where it leads; ⌘/Ctrl+click opens the chapter with the figure, a plain click does not', async ({ page }) => {
    const chip = visual(page).locator('.typst-labels__ref[data-target="fig:compile-times"]');
    await chip.click();
    await expect(fileRow(page, 'chapters/introduction.typ')).toHaveAttribute('aria-selected', 'true');
    await chip.hover();
    await expect(visual(page)).toHaveAttribute('title', /^Go to Figure · Cold \(dark\) and incremental \(light\)… in chapters\/results\.typ \((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    await chip.click({ modifiers: ['ControlOrMeta'] });
    await expect(fileRow(page, 'chapters/results.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(visual(page).locator('h1')).toHaveText(/Results/);
  });

  test('in the Source editor, ⌘/Ctrl+click on a reference puts the cursor at the label in its chapter', async ({ page }) => {
    await page.getByRole('tab', { name: 'Source' }).click();
    const source = page.locator('[data-testid=typst-source]:visible');
    await source.locator('.typst-source__path', { hasText: '@fig:compile-times' }).click({ modifiers: ['ControlOrMeta'] });
    await expect(fileRow(page, 'chapters/results.typ')).toHaveAttribute('aria-selected', 'true');
    await expect(source.locator('.cm-activeLine')).toContainText('<fig:compile-times>');
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
  await link.click();
  expect(page.context().pages()).toHaveLength(1);
  await link.hover();
  await expect(visual(page)).toHaveAttribute('title', /^Open https:\/\/typst\.app\/ \(/);
  const opened = page.context().waitForEvent('page');
  await link.click({ modifiers: ['ControlOrMeta'] });
  await expect((await opened)).toHaveURL('https://typst.app/');
});
