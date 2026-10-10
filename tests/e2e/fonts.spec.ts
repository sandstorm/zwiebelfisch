// End-to-end tests (Playwright, against the demo build): the default fonts.
import { test, expect } from './fixtures';

test('loads the default fonts as separate assets and renders glyphs', async ({ page }) => {
  const fonts: string[] = [];
  page.on('requestfinished', (request) => {
    if (/\.(otf|ttf)$/.test(new URL(request.url()).pathname)) fonts.push(request.url());
  });
  await page.goto('/');
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg.locator('use').first()).toBeAttached();
  expect(fonts.some((url) => url.includes('LibertinusSerif-Regular'))).toBe(true);
  expect(fonts.length).toBe(17);
});
