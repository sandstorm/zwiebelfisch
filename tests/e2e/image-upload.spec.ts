// End-to-end tests (Playwright, against the demo build): uploading and inserting images.
import type { Locator, Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { test, expect } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const SOURCE = '#set page(width: 12cm, height: auto, margin: 1cm)\n\n= Title\n\nSome text.\n';

/** A `width`×`height` RGB PNG with noise, so it does not compress away (a big photo stand-in). */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = width * 3 + 1;
  const pixels = Buffer.alloc(row * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % row === 0 ? 0 : (i * 2654435761) >>> 24;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

const PHOTO = png(900, 1600);

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await page.locator('typst-editor').evaluate((el: Editor, source) => (el.value = source), SOURCE);
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Title');
});

const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);

/** Where the editing column and the preview column are, and whether anything sticks out sideways. */
async function layout(page: Page) {
  const editor = page.locator('typst-editor');
  const box = async (locator: Locator) => (await locator.boundingBox())!;
  const left = await box(editor.locator('.typst-editor__left'));
  const right = await box(editor.locator('.typst-editor__right'));
  const overflow = await editor
    .locator('.typst-editor__pane:visible')
    .evaluate((pane) => pane.scrollWidth - pane.clientWidth);
  return { left, right, overflow };
}

/** The editing view still shows main.typ: Visual view and toolbar visible, no asset view, preview beside it. */
async function expectLayoutIntact(page: Page, before: Awaited<ReturnType<typeof layout>>) {
  const editor = page.locator('typst-editor');
  await expect(editor.getByTestId('typst-visual')).toBeVisible();
  await expect(editor.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();
  await expect(editor.getByTestId('typst-asset')).toBeHidden();
  await expect(editor.getByTestId('typst-files').getByRole('tab', { name: /main\.typ/ })).toHaveAttribute('aria-selected', 'true');
  const after = await layout(page);
  for (const side of ['left', 'right'] as const) {
    expect(Math.abs(after[side].x - before[side].x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[side].width - before[side].width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[side].height - before[side].height)).toBeLessThanOrEqual(1);
  }
  expect(after.overflow).toBeLessThanOrEqual(0);
  // A big photo shows scaled down, not filling the editing view.
  const picture = editor.getByTestId('typst-visual').locator('.typst-visual__image img.typst-visual__rendering').first();
  await expect(picture).toBeVisible();
  expect((await picture.boundingBox())!.height).toBeLessThan(after.left.height * 0.7);
  expect(page.url()).toContain('/examples/plain-html/');
}

test('uploading an image with Insert image keeps the layout and the page setup', async ({ page }) => {
  const before = await layout(page);
  const editor = page.locator('typst-editor');
  // No click into the text first: the selection is still on the #set page block.
  await editor.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert image' }).click();
  const form = editor.getByRole('form', { name: 'Image' });
  await expect(form).toBeVisible();
  expect(await layout(page).then((l) => l.overflow)).toBeLessThanOrEqual(0); // the popover does not stick out
  await form.locator('input[type="file"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PHOTO });

  await expect.poll(value(page)).toContain('#image("photo.png")');
  // Inserted as a block of its own; nothing replaced or split (before the fix it replaced #set page).
  const text = await value(page)();
  expect(text.startsWith('#set page(width: 12cm, height: auto, margin: 1cm)\n')).toBe(true);
  expect(text).toContain('\n\n#image("photo.png")\n\n');
  expect(text).toContain('= Title\n\nSome text.\n');
  await expect(form).toBeHidden();
  await expect(editor.getByTestId('typst-files')).toBeVisible(); // the project has two files now
  await expectLayoutIntact(page, before);
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page image')).toHaveCount(1);
  await expect(editor.getByTestId('typst-visual')).toBeFocused();
});

test('an image file dropped into the text is uploaded and inserted there, the page stays', async ({ page }) => {
  const before = await layout(page);
  const editor = page.locator('typst-editor');
  const dataTransfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    return transfer;
  }, PHOTO.toString('base64'));
  await editor.getByTestId('typst-visual').locator('p').first().dispatchEvent('drop', { dataTransfer });
  await expect.poll(value(page)).toContain('#image("dropped.png")');
  expect(await value(page)()).toContain('#set page(width: 12cm, height: auto, margin: 1cm)');
  await expectLayoutIntact(page, before);
});

test('a file dropped on the preview does not replace the page', async ({ page }) => {
  const editor = page.locator('typst-editor');
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    return transfer;
  });
  const preview = editor.getByTestId('typst-preview');
  await preview.dispatchEvent('dragover', { dataTransfer });
  await preview.dispatchEvent('drop', { dataTransfer });
  await expect(preview.locator('.typst-preview__page svg').first()).toBeVisible();
  expect(page.url()).toContain('/examples/plain-html/');
  expect(await value(page)()).toBe(SOURCE);
});
