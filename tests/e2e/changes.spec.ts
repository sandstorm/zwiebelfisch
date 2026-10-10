import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

type Editor = { source: string; setBase(base: string | null): void };

function replaceSource(page: Page, search: string, replacement: string): Promise<void> {
  return page.evaluate(
    ([s, r]) => {
      const { editor } = window as unknown as { editor: Editor };
      editor.source = editor.source.replace(s, r);
    },
    [search, replacement],
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  // Compare with the text as loaded: nothing has changed yet.
  await page.evaluate(() => {
    const { editor } = window as unknown as { editor: Editor };
    editor.setBase(editor.source);
  });
});

test('an edit after setBase() is highlighted as an insertion in the visual view', async ({ page }) => {
  const visual = page.getByTestId('typst-visual');
  await expect(visual.locator('.typst-diff-insert')).toHaveCount(0);
  await visual.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' World');
  await expect(visual.locator('.typst-diff-insert')).toHaveText(' World');
});

test('deleted words stay visible, struck through', async ({ page }) => {
  await replaceSource(page, 'This is ', '');
  await expect(page.getByTestId('typst-visual').locator('del.typst-diff-delete')).toHaveText('This is ');
});

test('changed text gets a change bar in the preview margin', async ({ page }) => {
  const preview = page.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__change-bar')).toHaveCount(0);
  await replaceSource(page, 'second item', 'second changed item');
  const bar = preview.locator('.typst-preview__change-bar');
  await expect(bar).toHaveCount(1);
  const barBox = await bar.boundingBox();
  const pageBox = await preview.locator('.typst-preview__page').first().boundingBox();
  expect(barBox!.x - pageBox!.x).toBeLessThan(pageBox!.width * 0.1); // in the margin
});

test('the source view shows an inline diff with accept / reject per chunk', async ({ page }) => {
  await replaceSource(page, '= Hello Typst', '= Hello Typst World');
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.getByTestId('typst-source');
  await expect(source.locator('.cm-deletedChunk')).toContainText('= Hello Typst');
  await source.locator('button[name=reject]').click();
  await expect(source.locator('.cm-deletedChunk')).toHaveCount(0);
  const text = await page.evaluate(() => (window as unknown as { editor: Editor }).editor.source);
  expect(text).toContain('= Hello Typst\n');
});

test('"Show changes" toggles all change markers', async ({ page }) => {
  await replaceSource(page, 'second item', 'second changed item');
  const toggle = page.getByRole('button', { name: 'Show changes' });
  const visual = page.getByTestId('typst-visual');
  const bars = page.getByTestId('typst-preview').locator('.typst-preview__change-bar');
  await expect(visual.locator('.typst-diff-insert')).toHaveCount(1);
  await expect(bars).toHaveCount(1);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(visual.locator('.typst-diff-insert')).toHaveCount(0);
  await expect(bars).toHaveCount(0);
  await toggle.click();
  await expect(visual.locator('.typst-diff-insert')).toHaveCount(1);
});
