// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): the Help panel
// in Files' place on the left, its sheet following the shown file (.typ → .mmd), and its rows dragged into the Source,
// the text and the Visual editor, and inserted with Enter.
import { expect, type Locator, type Page } from '@playwright/test';
import { test, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const value = (page: Page) => () => editor(page).evaluate((el: Editor) => el.value);
const help = (page: Page) => editor(page).getByTestId('typst-help');
/** The help row showing `snippet`. */
const row = (page: Page, snippet: string): Locator => help(page).getByRole('option').filter({ has: page.locator('code', { hasText: snippet }) }).first();

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(editor(page).getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/flow.mmd': 'flowchart LR\n' };
    el.value = 'Hello\n';
  });
});

test('Help takes the Files place and follows the shown file; a row dragged into the Source editor lands there', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  await editor(page).getByTestId('typst-panel-toggle-help').click();
  await expect(help(page).getByRole('heading', { name: 'Typst basics' })).toBeVisible();
  await expect(editor(page).getByTestId('typst-files')).toBeHidden();
  await expect(help(page).getByRole('link', { name: 'Typst documentation' })).toHaveAttribute('href', 'https://typst.app/docs');

  // a click selects a row and shows its whole snippet
  await row(page, '#table(').click();
  await expect(row(page, '#table(')).toHaveAttribute('aria-selected', 'true');

  await row(page, '*strong*').dragTo(editor(page).getByTestId('typst-source').locator('.cm-line').first());
  await expect.poll(value(page)).toContain('*strong*');

  await editor(page).getByTestId('typst-panel-toggle-files').click();
  await fileRow(editor(page), 'flow.mmd').click();
  await editor(page).getByTestId('typst-panel-toggle-help').click();
  await expect(help(page).getByRole('heading', { name: 'Mermaid basics' })).toBeVisible();
  await expect(help(page).getByRole('heading', { name: 'Typst basics' })).toHaveCount(0);

  const text = editor(page).getByTestId('typst-text-file').locator('.cm-content');
  await row(page, 'A --> B').dragTo(text.locator('.cm-line').last());
  await expect(text).toContainText('A --> B');
});

test('a Typst row dragged into the Visual editor is read as Typst; Enter inserts the selected row at the cursor', async ({ page }) => {
  await editor(page).getByTestId('typst-panel-toggle-help').click();
  await row(page, '= Heading').dragTo(editor(page).getByTestId('typst-visual').locator('p').first());
  await expect.poll(value(page)).toBe('Hello\n\n= Heading\n');
  await expect(editor(page).getByTestId('typst-visual').getByRole('heading', { name: 'Heading' })).toBeVisible();

  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('End');
  await row(page, '*strong*').click();
  await page.keyboard.press('Enter');
  await expect.poll(value(page)).toBe('Hello*strong*\n\n= Heading\n');
});
