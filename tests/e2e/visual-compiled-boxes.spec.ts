import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>';
/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

async function load(page: Page, value: string, files: Record<string, string> = {}) {
  await page.locator('typst-editor').evaluate(
    (el: Editor, [value, files]) => {
      el.files = Object.fromEntries(Object.entries(files).map(([path, text]) => [path, new TextEncoder().encode(text)]));
      el.value = value;
    },
    [value, files] as const,
  );
}

const visual = (page: Page) => page.getByTestId('typst-visual');
const picture = (box: Locator) => box.locator('img.typst-visual__rendering');
const code = (box: Locator) => box.locator('.typst-visual__code');
const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);

test('display math shows as compiled; clicking it shows the code, Escape the rendering again', async ({ page }) => {
  await load(page, 'Intro\n\n$ x^2 + 1/2 $\n\nOutro\n');
  const box = visual(page).locator('.typst-visual__raw-block');
  await expect(picture(box)).toBeVisible();
  await expect(code(box)).toBeHidden();
  expect(await picture(box).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await picture(box).click();
  await expect(code(box)).toBeVisible();
  await expect(box.locator('.cm-editor')).toHaveClass(/cm-focused/);
  await page.keyboard.press('Escape');
  await expect(picture(box)).toBeVisible();
  await expect(code(box)).toBeHidden();
});

test('editing math in its box updates the rendering after the next compile', async ({ page }) => {
  await load(page, 'Intro\n\n$ x $\n\nOutro\n');
  const box = visual(page).locator('.typst-visual__raw-block');
  const before = await picture(box).getAttribute('src');
  await picture(box).click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' + y^2');
  await page.keyboard.press('Escape');
  await expect.poll(value(page)).toContain('$ x + y^2 $');
  await expect.poll(() => picture(box).getAttribute('src')).not.toBe(before);
});

test('a set rule keeps showing its code', async ({ page }) => {
  await load(page, '#set text(size: 12pt)\n\nHello\n');
  const box = visual(page).locator('.typst-visual__raw-block');
  await expect(code(box)).toBeVisible();
  await expect(picture(box)).toBeHidden();
});

test('an image block shows the image file from the project; a click selects it, a double-click shows its code', async ({ page }) => {
  await load(page, '#image("logo.svg")\n\nText\n', { '/logo.svg': SVG });
  const box = visual(page).locator('.typst-visual__image');
  await expect(picture(box)).toBeVisible();
  await expect(picture(box)).toHaveAttribute('src', /^blob:/);
  expect(await picture(box).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await picture(box).click();
  await expect(box.getByRole('toolbar', { name: 'Image' })).toBeVisible();
  await expect(code(box)).toBeHidden();
  await picture(box).dblclick();
  await expect(code(box)).toBeVisible();
});

test('Insert image offers the project images', async ({ page }) => {
  await load(page, 'Text\n', { '/logo.svg': SVG });
  await visual(page).locator('p').first().click();
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert image' }).click();
  await page.getByRole('form', { name: 'Image' }).getByRole('button', { name: 'logo.svg' }).click();
  await expect.poll(value(page)).toContain('#image("logo.svg")');
  await expect(picture(visual(page).locator('.typst-visual__image'))).toBeVisible();
});

test('Insert image uploads a file into the project and inserts it', async ({ page }) => {
  await load(page, 'Text\n');
  await visual(page).locator('p').first().click();
  await page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert image' }).click();
  const form = page.getByRole('form', { name: 'Image' });
  await form.locator('input[type="file"]').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(value(page)).toContain('#image("cat.png")');
  expect(await page.locator('typst-editor').evaluate((el: Editor) => Object.keys(el.files))).toContain('/cat.png');
  await expect(picture(visual(page).locator('.typst-visual__image'))).toBeVisible();
});
