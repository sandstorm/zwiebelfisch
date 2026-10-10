// End-to-end tests (Playwright, against the demo build): figures and image resizing in the Visual view.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { caretAtEnd, chooseFrom } from './visual-helpers';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="teal"/></svg>';

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

async function load(page: Page, value: string) {
  // evaluate runs in the page: SVG travels as an argument (a closure over it is not serialized).
  await page.locator('typst-editor').evaluate(
    (el: Editor, { value, svg }) => {
      el.files = { '/logo.svg': new TextEncoder().encode(svg) };
      el.value = value;
    },
    { value, svg: SVG },
  );
}

const visual = (page: Page) => page.getByTestId('typst-visual');
const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);
const imageBox = (page: Page) => visual(page).locator('.typst-visual__image');
const picture = (page: Page) => imageBox(page).locator('img.typst-visual__rendering');
const imageTools = (page: Page) => imageBox(page).getByRole('toolbar', { name: 'Image' });

test('a figure shows its image and its caption as editable rich text; label and arguments stay', async ({ page }) => {
  await load(page, '#figure(image("logo.svg", width: 50%), caption: [A *logo* image], placement: top) <fig:logo>\n');
  const caption = visual(page).locator('figure figcaption');
  await expect(caption).toHaveText('A logo image');
  await expect(caption.locator('strong')).toHaveText('logo');
  await expect(picture(page)).toBeVisible();
  // not click + End: ProseMirror's focus timer can undo the caret move, and End is no line end on macOS
  await caretAtEnd(caption);
  await page.keyboard.type(' here');
  await expect.poll(value(page)).toBe('#figure(image("logo.svg", width: 50%), caption: [A *logo* image here], placement: top) <fig:logo>\n');
});

test('insert an image, add a caption, type it, drag a handle: the source gets the caption and width: …%', async ({ page }) => {
  await load(page, 'Text\n');
  await visual(page).locator('p').first().click();
  await chooseFrom(page.getByRole('toolbar', { name: 'Formatting' }), 'Insert', 'Insert image');
  await page.getByRole('form', { name: 'Image' }).getByRole('button', { name: 'logo.svg' }).click();
  await expect.poll(value(page)).toContain('#image("logo.svg")');

  await picture(page).click();
  await imageTools(page).getByRole('button', { name: 'Add caption' }).click();
  await page.keyboard.type('A teal box');
  await expect.poll(value(page)).toContain('#figure(image("logo.svg"), caption: [A teal box])');

  await picture(page).click();
  const handle = imageBox(page).locator('[data-handle="e"]');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 5 });
  await expect(imageBox(page).locator('.typst-visual__image-size')).toHaveText(/^\d+%$/);
  await page.mouse.up();
  await expect.poll(value(page)).toMatch(/#figure\(image\("logo\.svg", width: \d+%\), caption: \[A teal box\]\)/);

  // one undo step takes the width back
  await page.keyboard.press('ControlOrMeta+Z');
  await expect.poll(value(page)).toContain('#figure(image("logo.svg"), caption: [A teal box])');
});

test('preset widths, alt text and Remove caption in the image toolbar', async ({ page }) => {
  await load(page, '#figure(image("logo.svg"), caption: [Logo])\n\nText\n');
  await picture(page).click();
  await imageTools(page).getByRole('button', { name: 'Width 25%' }).click();
  await expect.poll(value(page)).toContain('image("logo.svg", width: 25%)');

  await imageTools(page).getByRole('button', { name: 'Alt text' }).click();
  const alt = imageTools(page).getByRole('form', { name: 'Alt text' });
  await alt.getByLabel('Alt text').fill('A teal box');
  await alt.getByLabel('Alt text').press('Enter');
  await expect.poll(value(page)).toContain('image("logo.svg", width: 25%, alt: "A teal box")');

  await picture(page).click();
  await imageTools(page).getByRole('button', { name: 'Remove caption' }).click();
  await expect.poll(value(page)).toBe('#image("logo.svg", width: 25%, alt: "A teal box")\n\nText\n');
});
