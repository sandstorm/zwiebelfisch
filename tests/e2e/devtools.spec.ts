// End-to-end tests (Playwright, against the demo build): the devtools panel on the right side, there by default
// (src/extensions/devtools/).
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Typst in five minutes');
  await page.getByTestId('typst-panel-toggle-devtools').click();
});

test('the devtools are on the right side in place of the preview, which keeps compiling', async ({ page }) => {
  await expect(page.locator('.typst-editor__side--right').getByTestId('typst-devtools')).toBeVisible();
  await expect(page.getByTestId('typst-preview')).toBeHidden();
  await page.getByTestId('typst-visual').locator('h1').click();
  await page.keyboard.type(' again');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await page.getByTestId('typst-panel-toggle-preview').click();
  await expect(page.getByTestId('typst-devtools')).toBeHidden();
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg').first()).toBeVisible();
});

test('the setting devtools.enabled removes the panel and its rail button, and brings them back', async ({ page }) => {
  const setEnabled = (enabled: boolean) =>
    page.evaluate((value) => ((window as unknown as { editor: { settings: object } }).editor.settings = { 'devtools.enabled': value }), enabled);
  await setEnabled(false);
  await expect(page.getByTestId('typst-panel-toggle-devtools')).toBeHidden();
  await expect(page.getByTestId('typst-devtools')).toBeHidden();
  await setEnabled(true);
  await expect(page.getByTestId('typst-panel-toggle-devtools')).toBeVisible();
});

test('the document tab shows the Visual editor as nodes with their source ranges; a click selects one', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  const heading = devtools.locator('.typst-devtools__node').filter({ hasText: /^heading\d+–\d+/ }).first();
  await expect(heading).toBeVisible();
  await heading.click();
  // the heading's text is selected in the Visual editor, and the row is on the selection's path
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Typst in five minutes');
  await expect(devtools.locator('.typst-devtools__row--selected').first()).toContainText('heading');
});

test('the contributions tab says what each extension contributed, by extension or by contribution point', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  await devtools.getByRole('tab', { name: 'Contributions' }).click();
  const group = (name: RegExp) => devtools.locator('details').filter({ has: page.locator('summary', { hasText: name }) });
  const files = group(/^files/);
  await expect(files).toContainText('commands.registerCommand');
  await expect(files).toContainText('files.newFile');
  await expect(files).toContainText('files.panel');
  const heading = group(/^headings/).locator('.typst-devtools__contribution').filter({ hasText: 'visualEditor.registerNode' });
  await expect(heading).toContainText('parses Heading');
  await expect(heading).toHaveAttribute('title', /^visualEditor\.registerNode: heading\nby headings/);
  await expect(group(/^comments/)).toContainText('→ comments.addComment');

  await devtools.getByRole('button', { name: 'By contribution point' }).click();
  // the box renderers in the order they are asked: images (110) before compiled snippets (100)
  const renderers = group(/^visualEditor\.registerRawBoxRenderer/).locator('.typst-devtools__contribution');
  await expect(renderers.first()).toContainText('priority 110');
  await expect(renderers.nth(1)).toContainText('priority 100');
});

test('the events tab logs events as they fire, their values in full; filter, pause, clear', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  await devtools.getByRole('tab', { name: 'Events' }).click();
  await page.getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.type('x');
  await expect(devtools).toContainText('project.onDidChangeFile');
  await expect(devtools).toContainText('window.onDidChangeTextEditorSelection');
  await expect(devtools.locator('.typst-devtools__event').filter({ hasText: 'project.onDidChangeFile' }).first()).toContainText('kind: "update"');

  await devtools.getByRole('searchbox').fill('selection');
  await expect(devtools).not.toContainText('project.onDidChangeFile');
  await devtools.getByRole('searchbox').fill('');

  await devtools.getByRole('button', { name: 'Pause' }).click();
  await devtools.getByRole('button', { name: 'Clear' }).click();
  await page.getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.type('y');
  await expect(devtools).not.toContainText('project.onDidChangeFile');
  await devtools.getByRole('button', { name: 'Pause' }).click();
  await page.keyboard.type('z');
  await expect(devtools).toContainText('project.onDidChangeFile');
});
