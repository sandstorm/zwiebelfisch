// End-to-end tests (Playwright, against the demo build): the demo's examples.
import type { Page } from '@playwright/test';
import { test, expect, fileRow } from './fixtures';

const examples = (page: Page) => page.getByRole('navigation', { name: 'Examples' });
const preview = (page: Page) => page.getByTestId('typst-preview');

test('without ?example the demo opens the default document', async ({ page }) => {
  await page.goto('/');
  await expect(examples(page).getByRole('link', { name: 'Hello' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  await expect(page.getByTestId('typst-files')).toBeHidden();
});

test('the simple example is one file with a table', async ({ page }) => {
  await page.goto('/?example=simple');
  await expect(examples(page).getByRole('link', { name: 'Simple' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Typst in five minutes');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await expect(page.getByTestId('typst-files')).toBeHidden();
});

test('the advanced example is a multi-page project with chapters and an image', async ({ page }) => {
  await page.goto('/?example=advanced');
  await expect(fileRow(page, 'template.typ')).toBeVisible();
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'false');
  await fileRow(page, 'chapters').click();
  await expect(fileRow(page, 'chapters/introduction.typ')).toBeVisible();
  await fileRow(page, 'assets').click();
  await expect(fileRow(page, 'assets/compile-times.svg')).toBeVisible();
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await expect(preview(page).locator('.typst-preview__page')).toHaveCount(3);
});

test('switching examples keeps the other URL parameters', async ({ page }) => {
  await page.goto('/?example=simple&user=Ada');
  await examples(page).getByRole('link', { name: 'Advanced' }).click();
  await expect(page).toHaveURL(/\?example=advanced&user=Ada$/);
  await expect(examples(page).getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page');
});

test('the older ?files opens the advanced example', async ({ page }) => {
  await page.goto('/?files');
  await expect(examples(page).getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page');
  await expect(fileRow(page, 'template.typ')).toBeVisible();
});

test('the advanced example declares custom styles: styled text in the Visual view, offered in the style menu', async ({ page }) => {
  await page.goto('/?example=advanced#/chapters/introduction.typ');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  const visual = page.locator('[data-testid=typst-visual]:visible');
  await expect(visual.locator('.typst-visual__style.typst-style--note')).toHaveAttribute('data-style-title', 'Note');
  await expect(visual.locator('.typst-visual__style-text.typst-style--term').first()).toHaveText('incrementally');
  const menu = page.locator('[role=toolbar][aria-label=Formatting]:visible').getByRole('combobox', { name: 'Text style' });
  await expect(menu.locator('optgroup[label="Paragraph styles"] option')).toHaveText(['Note']);
  await expect(menu.locator('optgroup[label="Text styles"] option')).toHaveText(['Term']);
});
