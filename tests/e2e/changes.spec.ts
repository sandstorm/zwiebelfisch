// End-to-end tests (Playwright, against the demo build): "Changes since …" in both views and the preview.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { caretAtEnd } from './visual-helpers';

type Editor = { source: string; files: Record<string, string | Uint8Array>; open(path: string): void; setBase(base: string | null): void };

function replaceSource(page: Page, search: string, replacement: string): Promise<void> {
  return page.evaluate(
    ([s, r]) => {
      const { editor } = window as unknown as { editor: Editor };
      editor.source = editor.source.replace(s, r);
    },
    [search, replacement],
  );
}

test.describe('the hello example (main file only)', () => {
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

  test('"Changes since …" toggles all change markers', async ({ page }) => {
    await replaceSource(page, 'second item', 'second changed item');
    const toggle = page.getByRole('button', { name: /^Changes since/ });
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
});

test.describe('the advanced example (chapters in their own files)', () => {
  const CHAPTER = '/chapters/introduction.typ';

  test.beforeEach(async ({ page }) => {
    await page.goto('/?example=advanced');
    await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  });

  test('the toggle names the text as opened and is off at first', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Changes since opened' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('editing a chapter file shows the changes there: Visual view, Source view and preview', async ({ page }) => {
    await page.evaluate((path) => {
      const { editor } = window as unknown as { editor: Editor };
      editor.open(path);
      const text = editor.files[path] as string;
      editor.files = { ...editor.files, [path]: text.replace('Writers want', 'Writers really want') };
    }, CHAPTER);
    await page.getByRole('button', { name: 'Changes since opened' }).click();
    const visual = page.getByTestId('typst-visual').filter({ visible: true });
    await expect(visual.locator('.typst-diff-insert')).toHaveText('really ');
    await expect(page.getByTestId('typst-preview').locator('.typst-preview__change-bar')).toHaveCount(1);
    await page.getByRole('tab', { name: 'Source' }).click();
    await expect(page.getByTestId('typst-source').filter({ visible: true }).locator('.cm-changedLine')).toHaveCount(1);
  });

  test('typing in a chapter file in the Visual view marks the insertion', async ({ page }) => {
    await page.evaluate((path) => (window as unknown as { editor: Editor }).editor.open(path), CHAPTER);
    await page.getByRole('button', { name: 'Changes since opened' }).click();
    const visual = page.getByTestId('typst-visual').filter({ visible: true });
    // not click() and type: within ProseMirror's 20 ms post-focus sync the keys land at its previous
    // selection (the `#import` box at the top, which typing replaces); see caretAtEnd
    await caretAtEnd(visual.locator('p', { hasText: 'Writers want' }));
    await page.keyboard.type(' and more ');
    await expect(visual.locator('.typst-diff-insert')).toContainText('and more');
    await expect(page.getByTestId('typst-preview').locator('.typst-preview__change-bar')).toHaveCount(1);
  });
});
