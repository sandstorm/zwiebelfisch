import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

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
  const files = page.getByTestId('typst-files');
  await expect(files.getByRole('tab', { name: /template\.typ/ })).toBeVisible();
  await expect(files.getByRole('tab', { name: /introduction\.typ/ })).toBeVisible();
  await expect(files.getByRole('tab', { name: /compile-times\.svg/ })).toBeVisible();
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
  await expect(page.getByTestId('typst-files').getByRole('tab', { name: /template\.typ/ })).toBeVisible();
});
