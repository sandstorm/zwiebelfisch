// End-to-end tests (Playwright, against the demo build): the default fonts, loaded on first use, and project fonts.
import { expect } from '@playwright/test';
import { test, openFile } from './fixtures';

test('loads only the default fonts the document uses, as separate assets, and renders glyphs', async ({ page }) => {
  const fonts: string[] = [];
  page.on('requestfinished', (request) => {
    if (/\.(otf|ttf)$/.test(new URL(request.url()).pathname)) fonts.push(request.url());
  });
  await page.goto('/');
  const svg = page.getByTestId('typst-preview').locator('.typst-preview__page svg').first();
  await expect(svg.locator('use').first()).toBeAttached();
  // the hello example: Libertinus Serif regular, bold and italic, and the math font (demo/examples.test.ts)
  await expect.poll(() => fonts.length).toBe(4);
  for (const name of ['LibertinusSerif-Regular', 'LibertinusSerif-Bold', 'LibertinusSerif-Italic', 'NewCMMath-Book']) {
    expect(fonts.some((url) => url.includes(name))).toBe(true);
  }
});

test('loads a font the document starts using later', async ({ page }) => {
  const fonts: string[] = [];
  page.on('requestfinished', (request) => {
    if (/\.(otf|ttf)$/.test(new URL(request.url()).pathname)) fonts.push(request.url());
  });
  await page.goto('/');
  const preview = page.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__page svg use').first()).toBeAttached();
  await expect.poll(() => fonts.length).toBe(4);
  await page.getByRole('tab', { name: 'Source' }).click();
  await page.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  // raw text is set in DejaVu Sans Mono
  await page.keyboard.type('\n\nSome `code`');
  await expect.poll(() => fonts.some((url) => url.includes('DejaVuSansMono'))).toBe(true);
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});

test('uses the font files among the project files: the documentation sets its text in Gabarito from fonts/', async ({ page }) => {
  await page.goto('/?example=docs');
  // "✓ compiled": no warning, so Typst knew the family the template asks for (demo/examples.test.ts)
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await openFile(page, 'fonts/Gabarito-Regular.ttf');
  const info = page.getByTestId('typst-file-info');
  await expect(info.locator('h2')).toHaveText('fonts/Gabarito-Regular.ttf');
  await expect(info).toContainText('TTF file');
});
