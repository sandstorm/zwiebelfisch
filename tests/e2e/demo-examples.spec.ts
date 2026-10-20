// End-to-end tests (Playwright, against the demo build): the demo's examples.
import { expect, type Page } from '@playwright/test';
import { test, fileRow } from './fixtures';
import { caretAtStart } from './visual-helpers';

const examples = (page: Page) => page.getByRole('navigation', { name: 'Examples' });
const preview = (page: Page) => page.getByTestId('zwf-preview');

test('without ?example the demo opens the simple example: a page with a spreadsheet, diagrams and custom styles', async ({ page }) => {
  await page.goto('/');
  await expect(examples(page).getByRole('link', { name: 'Simple' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('zwf-visual').locator('h1')).toHaveText('Typst in five minutes');
  // it imports three packages: drafting, cheq and merman
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await expect(preview(page).locator('.zwf-preview__page')).toHaveCount(1);
  await expect(fileRow(page, 'styles.typ')).toBeVisible();
  await fileRow(page, 'data').click();
  await expect(fileRow(page, 'data/budget.ic')).toBeVisible();
  await fileRow(page, 'diagrams').click();
  await expect(fileRow(page, 'diagrams/editor.drawio.png')).toBeVisible();
  await expect(fileRow(page, 'diagrams/workflow.mmd')).toBeVisible();
  // the comment's card (opened from its marker), and the custom styles in the text style menu
  await page.getByTestId('zwf-visual').locator('[data-testid="zwf-note-marker"][title^="Ada:"]').click();
  await expect(page.getByTestId('zwf-note-card').locator('.zwf-comments__card-author')).toHaveText(['Ada', 'Grace']);
  await page.keyboard.press('Escape');
  const menu = page.locator('[role=toolbar][aria-label=Formatting]:visible').getByRole('combobox', { name: 'Text style' });
  await expect(menu.locator('optgroup[label="Block styles"] option')).toHaveText(['Tip']);
  await expect(menu.locator('optgroup[label="Inline styles"] option')).toHaveText(['Key']);
});

test('the advanced example is a multi-page project with chapters, an image and a Mermaid diagram', async ({ page }) => {
  await page.goto('/?example=advanced');
  await expect(fileRow(page, 'template.typ')).toBeVisible();
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'false');
  await fileRow(page, 'chapters').click();
  await expect(fileRow(page, 'chapters/introduction.typ')).toBeVisible();
  await fileRow(page, 'assets').click();
  await expect(fileRow(page, 'assets/compile-times.svg')).toBeVisible();
  await fileRow(page, 'diagrams').click();
  await expect(fileRow(page, 'diagrams/measurement.mmd')).toBeVisible();
  // the Mermaid figure needs the merman package, downloaded from packages.typst.org
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await expect(preview(page).locator('.zwf-preview__page')).toHaveCount(4);
});

test('the documentation example is docs/ as a book with parts and chapters', async ({ page }) => {
  await page.goto('/?example=docs');
  await expect(examples(page).getByRole('link', { name: 'Documentation' })).toHaveAttribute('aria-current', 'page');
  await expect(fileRow(page, 'template.typ')).toBeVisible();
  await fileRow(page, '40_architecture').click();
  await expect(fileRow(page, '40_architecture/07_window.typ')).toBeVisible();
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
  await expect(preview(page).locator('.zwf-preview__page').first()).toBeVisible();
});

test('switching examples keeps the other URL parameters', async ({ page }) => {
  await page.goto('/?example=simple&user=Ada');
  await examples(page).getByRole('link', { name: 'Advanced' }).click();
  await expect(page).toHaveURL(/\?example=advanced&user=Ada(#.*)?$/);
  await expect(examples(page).getByRole('link', { name: 'Advanced' })).toHaveAttribute('aria-current', 'page');
});

test('the advanced example declares custom styles: styled text in the Visual editor, offered in the style menu', async ({ page }) => {
  await page.goto('/?example=advanced#/chapters/introduction.typ');
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
  const visual = page.locator('[data-testid=zwf-visual]:visible');
  await expect(visual.locator('.zwf-styles__block.zwf-styles--note')).toHaveAttribute('data-style-title', 'Note');
  await expect(visual.locator('.zwf-styles__inline.zwf-styles--term').first()).toHaveText('incrementally');
  const menu = page.locator('[role=toolbar][aria-label=Formatting]:visible').getByRole('combobox', { name: 'Text style' });
  await expect(menu.locator('optgroup[label="Block styles"] option')).toHaveText(['Note']);
  await expect(menu.locator('optgroup[label="Inline styles"] option')).toHaveText(['Term']);
});

test('the URL keeps the shown file and the cursor\'s line: a reload opens them there', async ({ page }) => {
  const chapter = '/chapters/introduction.typ';
  await page.goto(`/?example=advanced#${chapter}`);
  const visual = page.locator('[data-testid=zwf-visual]:visible');
  await caretAtStart(visual.getByText('This report measures').first());
  await page.keyboard.type('Now ');
  await expect(page).toHaveURL(/#\/chapters\/introduction\.typ:10$/);

  await page.reload();
  await expect(page).toHaveURL(/#\/chapters\/introduction\.typ:10$/);
  await expect(visual.getByText('This report measures').first()).toBeInViewport();
  // the cursor is at the start of line 10 (the edit before the reload was not saved: Local mode)
  await page.keyboard.type('Z');
  const text = () => page.evaluate((path) => (window as unknown as { editor: { files: Record<string, string> } }).editor.files[path], chapter);
  await expect.poll(async () => (await text()).split('\n')[9]).toMatch(/^ZThis report measures/);
});

test('a URL naming a file the example does not have opens the main file and names it', async ({ page }) => {
  await page.goto('/?example=advanced#/extensions/visual-view-constructs.typ');
  await expect(page).toHaveURL(/#\/main\.typ:\d+$/);
});
