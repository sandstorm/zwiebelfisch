import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// The "Comment" button now adds drafting margin notes (margin-notes.spec.ts); the sidecar
// comments this spec covers are being removed (docs/todo/comments-drafting.md).
test.skip(() => true, 'sidecar comments are replaced by margin notes');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const panel = (page: Page) => page.getByTestId('typst-comments');
const commentButton = (page: Page) => page.locator('.typst-editor__comment');

/** Selects the bold word in the visual view and comments on it. */
async function commentOnBold(page: Page, text: string) {
  await page.getByTestId('typst-visual').locator('strong', { hasText: 'bold' }).dblclick();
  await commentButton(page).click();
  const box = panel(page).getByRole('textbox', { name: 'Add a comment' });
  await expect(box).toBeFocused();
  await box.fill(text);
  await panel(page).getByRole('button', { name: 'Comment', exact: true }).click();
}

test('a comment made in the visual view shows in the panel, the source view and the preview', async ({ page }) => {
  await expect(panel(page)).toBeHidden();
  await commentOnBold(page, 'Is bold right here?');

  const card = panel(page).locator('.typst-comment');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.typst-comment__quote')).toHaveText('bold');
  await expect(card.locator('.typst-comment__text')).toHaveText('Is bold right here?');
  await expect(card.locator('.typst-comment__author')).toHaveText('Demo user');

  await expect(page.getByTestId('typst-visual').locator('.typst-comment-range')).toHaveText('bold');
  await expect(page.getByTestId('typst-preview').locator('.typst-comment-marker')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Source' }).click();
  await expect(page.getByTestId('typst-source').locator('.typst-comment-range')).toHaveText('bold');
});

test('replies, then resolving removes highlight and marker but keeps the thread', async ({ page }) => {
  await commentOnBold(page, 'First');
  const card = panel(page).locator('.typst-comment');
  await card.getByRole('textbox', { name: 'Reply' }).fill('Second');
  await card.getByRole('button', { name: 'Reply' }).click();
  await expect(card.locator('.typst-comment__text')).toHaveText(['First', 'Second']);

  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(card).toHaveClass(/typst-comment--resolved/);
  await expect(page.getByTestId('typst-visual').locator('.typst-comment-range')).toHaveCount(0);
  await expect(page.getByTestId('typst-preview').locator('.typst-comment-marker')).toHaveCount(0);

  await card.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByTestId('typst-visual').locator('.typst-comment-range')).toHaveText('bold');
});

test('the comment follows its text through edits in the source view', async ({ page }) => {
  await commentOnBold(page, 'Track me');
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.getByTestId('typst-source');
  await source.locator('.cm-line', { hasText: 'This is' }).click();
  await page.keyboard.press('Home');
  await page.keyboard.type('Indeed, ');
  await expect(source.locator('.typst-comment-range')).toHaveText('bold');
  await page.getByRole('tab', { name: 'Visual' }).click();
  await expect(page.getByTestId('typst-visual').locator('.typst-comment-range')).toHaveText('bold');
});

test('Mod-Alt-M comments on the selection in the source view; clicking the marker selects the thread', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  await page.getByTestId('typst-source').locator('.cm-line', { hasText: 'Hello Typst' }).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('ControlOrMeta+Alt+KeyM');
  await panel(page).getByRole('textbox', { name: 'Add a comment' }).fill('Better title?');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(panel(page).locator('.typst-comment__quote')).toHaveText('= Hello Typst');

  await page.getByTestId('typst-source').locator('.cm-line', { hasText: 'This is' }).click();
  await page.getByTestId('typst-preview').locator('.typst-comment-marker').click();
  await expect(panel(page).locator('.typst-comment')).toHaveClass(/typst-comment--active/);
  const selected = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="typst-source"]');
    return root ? window.getSelection()?.toString() : null;
  });
  expect(selected).toBe('= Hello Typst');
});

test('comments are reported as JSON with quote anchors and can be restored', async ({ page }) => {
  await commentOnBold(page, 'Persist me');
  const json = await page.evaluate(() => (window as unknown as { editor: { comments: string } }).editor.comments);
  const data = JSON.parse(json);
  expect(data.threads[0].anchor).toMatchObject({ exact: 'bold' });
  await page.evaluate(() => {
    (window as unknown as { editor: { comments: string } }).editor.comments = '{"version":1,"threads":[]}';
  });
  await expect(panel(page)).toBeHidden();
  await page.evaluate((saved) => {
    (window as unknown as { editor: { comments: string } }).editor.comments = saved;
  }, json);
  await expect(panel(page).locator('.typst-comment__text')).toHaveText('Persist me');
});
