// End-to-end tests (Playwright, against the demo build): the demo's devtools panel (`?devtools`, demo/devtools/).
import { expect } from '@playwright/test';
import { test } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/?devtools');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Hello Typst');
  await page.getByTestId('typst-panel-toggle-devtools').click();
});

test('the document tab shows the Visual view as nodes with their source ranges; a click selects one', async ({ page }) => {
  const devtools = page.getByTestId('typst-devtools');
  const heading = devtools.locator('.typst-devtools__node').filter({ hasText: /^heading\d+–\d+/ }).first();
  await expect(heading).toBeVisible();
  await heading.click();
  // the heading's text is selected in the Visual view, and the row is on the selection's path
  await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Hello Typst');
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
  const heading = group(/^headings/).locator('.typst-devtools__contribution').filter({ hasText: 'visualView.registerNode' });
  await expect(heading).toContainText('parses Heading');
  await expect(heading).toHaveAttribute('title', /^visualView\.registerNode: heading\nby headings/);
  await expect(group(/^comments/)).toContainText('→ comments.addComment');

  await devtools.getByRole('button', { name: 'By contribution point' }).click();
  // the box renderers in the order they are asked: images (110) before compiled snippets (100)
  const renderers = group(/^visualView\.registerBoxRenderer/).locator('.typst-devtools__contribution');
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
