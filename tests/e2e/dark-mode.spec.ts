// End-to-end tests (Playwright, against the demo build): dark mode follows the page's color-scheme (the demo: the OS).
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.describe('with the OS in dark mode', () => {
  test.use({ colorScheme: 'dark' });

  test('the widget is dark, CodeMirror uses its dark theme, the preview shows the pages inverted', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('zwf-visual').locator('h1')).toHaveText('Typst in five minutes');
    await expect(page.locator('.zwf-editor')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(page.locator('.zwf-preview__page').first()).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('.zwf-preview__content').first()).toHaveCSS('filter', 'invert(1) hue-rotate(180deg)');

    await page.getByRole('tab', { name: 'Source' }).click();
    // light-dark() resolves the text light, so the Source editor switches CodeMirror to its dark theme: a light cursor
    // (CodeMirror draws the cursor itself, `.cm-cursor`; the native caret of `.cm-content` is always transparent)
    await expect(page.getByTestId('zwf-source').locator('.cm-cursor-primary')).toHaveCSS('border-left-color', 'rgb(221, 221, 221)');
  });
});

test.describe('with the OS in light mode', () => {
  test.use({ colorScheme: 'light' });

  test('the widget is light', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('zwf-visual').locator('h1')).toHaveText('Typst in five minutes');
    await expect(page.locator('.zwf-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.zwf-preview__content').first()).toHaveCSS('filter', 'none');
  });
});
