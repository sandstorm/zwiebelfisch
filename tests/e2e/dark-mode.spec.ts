// End-to-end tests (Playwright, against the demo build): dark mode follows the page's color-scheme (the demo: the OS).
import { test, expect } from './fixtures';

test.describe('with the OS in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the widget is dark, CodeMirror uses its dark theme, the preview shows the pages inverted', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
    await expect(page.locator('.typst-editor')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(page.locator('.typst-preview__page').first()).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('.typst-preview__content').first()).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');

    await page.getByRole('tab', { name: 'Source' }).click();
    // light-dark() resolves the text light, so the Source view switches CodeMirror to its dark theme (a white caret)
    await expect(page.getByTestId('typst-source').locator('.cm-content')).toHaveCSS('caret-color', 'rgb(255, 255, 255)');
  });
});

test.describe('with the OS in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('the widget is light', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
    await expect(page.locator('.typst-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.typst-preview__content').first()).toHaveCSS('filter', 'none');
  });
});
