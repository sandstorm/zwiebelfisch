// End-to-end tests (Playwright, against the demo build): multi-file projects and packages.
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const greet = readFileSync(new URL('../../src/core/typst-engine/packages/fixtures/greet-0.1.0.tar.gz', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
});

test('includes other files and shows images given as bytes', async ({ page }) => {
  const editor = page.locator('typst-editor');
  const preview = editor.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__page svg')).toBeVisible();
  await editor.evaluate((el: Editor) => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    el.files = {
      '/chapter.typ': '#pagebreak()\n= From another file',
      '/logo.svg': new TextEncoder().encode(svg),
    };
    el.value = '#image("logo.svg", width: 1cm)\n#include "chapter.typ"';
  });
  await expect(preview.locator('.typst-preview__page')).toHaveCount(2);
  await expect(preview.locator('.typst-preview__page').first().locator('image')).toHaveCount(1);
  await expect(editor.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});

test('downloads an imported @preview package', async ({ page, context }) => {
  await context.route('https://packages.typst.org/preview/greet-0.1.0.tar.gz', (route) =>
    route.fulfill({ body: greet, contentType: 'application/gzip' }),
  );
  const editor = page.locator('typst-editor');
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor.evaluate((el: Editor) => {
    el.value = '#import "@preview/greet:0.1.0": greet\n#greet("World")';
  });
  await expect(editor.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await expect(editor.getByTestId('typst-preview')).not.toHaveClass(/typst-preview--stale/);
});

test('reports a package that cannot be downloaded', async ({ page, context }) => {
  await context.route('https://packages.typst.org/**', (route) => route.fulfill({ status: 404 }));
  const editor = page.locator('typst-editor');
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor.evaluate((el: Editor) => {
    el.value = '#import "@preview/nope:1.0.0": x';
  });
  await expect(editor.getByTestId('typst-status')).toHaveText(/error/);
  await expect(editor.getByTestId('typst-source').locator('.cm-lintRange-error')).toHaveCount(1);
});
