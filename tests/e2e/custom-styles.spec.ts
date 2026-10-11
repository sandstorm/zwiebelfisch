// End-to-end tests (Playwright, against the plain-HTML example): custom block and inline styles in the Visual editor.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, selectText } from './visual-helpers';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const STYLES = [
  '/// @style block Note',
  '#let note(body) = block(fill: luma(235), inset: 8pt, radius: 4pt, body)',
  '',
  '/// @style inline Keyword',
  '#let key(body) = text(fill: rgb("#1f4fa0"), weight: "bold", body)',
  '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await page.locator('typst-editor').evaluate(
    (el: Editor, styles) => {
      el.files = { '/styles.typ': styles };
      el.value = 'Intro\n\nA paragraph to style.\n';
    },
    STYLES,
  );
});

const visual = (page: Page) => page.locator('typst-editor [data-testid="typst-visual"]:visible');
const styleMenu = (page: Page) => page.locator('typst-editor').getByRole('toolbar', { name: 'Formatting' }).getByRole('combobox', { name: 'Text style' });
const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);

test('a declared block style wraps the paragraph, imports itself, stays editable and unwraps with Normal text', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p', { hasText: 'A paragraph' }));
  await styleMenu(page).selectOption({ label: 'Note' });
  await expect.poll(value(page)).toBe('#import "styles.typ": note\n\nIntro\n\n#note[A paragraph to style.]\n');
  const styled = visual(page).locator('.typst-styles__block.typst-styles--note');
  await expect(styled).toHaveAttribute('data-style-title', 'Note');
  await expect(styled.locator('p')).toHaveText('A paragraph to style.');
  await expect(page.locator('typst-editor').getByTestId('typst-status')).toHaveText(/✓/); // compiles: the import works

  await caretAtEnd(styled.locator('p'));
  await page.keyboard.type(' More.');
  await expect.poll(value(page)).toContain('#note[A paragraph to style. More.]');

  await page.locator('typst-editor').getByRole('tab', { name: 'Source' }).click();
  await expect(page.locator('typst-editor [data-testid="typst-source"]:visible')).toContainText('#note[A paragraph to style. More.]');
  await page.locator('typst-editor').getByRole('tab', { name: 'Visual' }).click();

  await caretAtEnd(styled.locator('p'));
  await styleMenu(page).selectOption({ label: 'Normal text' });
  await expect.poll(value(page)).toBe('#import "styles.typ": note\n\nIntro\n\nA paragraph to style. More.\n');
  await expect(visual(page).locator('.typst-styles__block')).toHaveCount(0);
});

test('a declared inline style goes around the selected words', async ({ page }) => {
  await selectText(visual(page).locator('p', { hasText: 'A paragraph' }), 'paragraph');
  await styleMenu(page).selectOption({ label: 'Keyword' });
  await expect.poll(value(page)).toBe('#import "styles.typ": key\n\nIntro\n\nA #key[paragraph] to style.\n');
  await expect(visual(page).locator('.typst-styles__inline')).toHaveText('paragraph');
});
