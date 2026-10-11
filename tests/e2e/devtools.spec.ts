// End-to-end tests (Playwright, against the demo build): the demo's devtools panel (`?devtools`, demo/devtools/).
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/?devtools');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  await page.getByTestId('typst-panel-toggle-devtools').click();
});

test('the projection tab shows the Visual view as nodes with their source ranges; a click selects one', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  const heading = devtools.locator('.typst-devtools__node').filter({ hasText: /^heading\d+–\d+/ }).first();
  await expect(heading).toBeVisible();
  await heading.click();
  // the heading's text is selected in the Visual view, and the row is on the selection's path
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Hello Typst');
  await expect(devtools.locator('.typst-devtools__row--selected').first()).toContainText('heading');
});

test('the contributions tab lists what each extension registered', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  await devtools.getByRole('tab', { name: 'Contributions' }).click();
  const files = devtools.locator('details').filter({ has: page.locator('summary', { hasText: /^files/ }) });
  await expect(files).toContainText('commands.registerCommand');
  await expect(files).toContainText('files.newFile');
  await expect(files).toContainText('files.panel');
  await expect(devtools.locator('details').filter({ has: page.locator('summary', { hasText: /^headings/ }) })).toContainText('visualView.registerNode');
});

test('the events tab logs events as they fire', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  await devtools.getByRole('tab', { name: 'Events' }).click();
  await page.getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.type('x');
  await expect(devtools).toContainText('project.onDidChangeFile');
  await expect(devtools).toContainText('window.onDidChangeTextEditorSelection');
  await devtools.getByRole('button', { name: 'Clear' }).click();
  await expect(devtools).not.toContainText('project.onDidChangeFile');
});
