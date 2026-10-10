// End-to-end tests (Playwright, against the demo build): the file panel's tree and file links in the code.
import { test, expect, fileRow, openFile } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/?example=advanced');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});

test('expanding a folder and clicking a file opens it', async ({ page }) => {
  await expect(fileRow(page, 'main.typ')).toHaveAttribute('aria-selected', 'true');
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'false');
  await fileRow(page, 'chapters').click();
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'true');
  await fileRow(page, 'chapters/method.typ').click();
  await expect(fileRow(page, 'chapters/method.typ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('typst-visual').locator('h1:visible')).toContainText('Method');
});

test('the tree works with the keyboard', async ({ page }) => {
  await fileRow(page, 'main.typ').focus();
  await page.keyboard.press('Home'); // the first folder
  await expect(fileRow(page, 'assets')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(fileRow(page, 'chapters')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(fileRow(page, 'chapters/introduction.typ')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('F2');
  await expect(page.getByRole('textbox', { name: 'Rename chapters/introduction.typ to' })).toHaveValue('chapters/introduction.typ');
});

test('Mod+click on the #import path in the Source view opens the file', async ({ page }) => {
  await page.getByRole('tab', { name: 'Source' }).click();
  const path = page.locator('[data-testid=typst-source]:visible .typst-source__path', { hasText: 'template.typ' });
  await path.hover();
  await expect(page.locator('.cm-tooltip')).toContainText('Open template.typ');
  await path.click({ modifiers: ['ControlOrMeta'] });
  await expect(fileRow(page, 'template.typ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-testid=typst-source]:visible')).toContainText('#let accent');
});

test('"Open template.typ" on a raw box in the Visual view shows on hover and opens the file', async ({ page }) => {
  const open = page.getByTestId('typst-visual').getByRole('button', { name: 'Open template.typ' });
  await expect(open).toBeHidden(); // takes no space while the pointer is elsewhere
  await page.getByTestId('typst-visual').locator('.typst-visual__raw-block', { has: open }).hover();
  await open.click();
  await expect(fileRow(page, 'template.typ')).toHaveAttribute('aria-selected', 'true');
});

test("an image box's path opens the image", async ({ page }) => {
  await openFile(page, 'chapters/results.typ');
  // the image box's path in its heading (or "Open …" on a raw box, should the figure stay raw)
  await page.locator('[data-testid=typst-visual]:visible').getByRole('button', { name: /compile-times\.svg/ }).first().click();
  await expect(fileRow(page, 'assets/compile-times.svg')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('typst-asset')).toBeVisible();
});

test('a file dragged onto a folder moves into it', async ({ page }) => {
  await fileRow(page, 'helpers.typ').dragTo(fileRow(page, 'chapters'));
  // the moved file is opened, which opens its folder (a click on the folder would close it again)
  await expect(fileRow(page, 'chapters/helpers.typ')).toHaveAttribute('aria-selected', 'true');
  await expect(fileRow(page, 'chapters')).toHaveAttribute('aria-expanded', 'true');
  await expect(fileRow(page, 'helpers.typ')).toHaveCount(0);
});

test('the panel can be collapsed and resized', async ({ page }) => {
  const files = page.getByTestId('typst-files');
  const separator = page.getByRole('separator', { name: 'Panel width' });
  const before = (await files.boundingBox())!.width;
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await files.boundingBox())!.width).toBeGreaterThan(before + 20);
  await page.getByTestId('typst-panel-toggle-files').click();
  await expect(files).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
  await expect(files).toBeHidden(); // remembered for the session
});

test('narrow: the panel is an overlay that closes after choosing a file', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  const files = page.getByTestId('typst-files');
  await expect(files).toBeHidden();
  await page.getByTestId('typst-panel-toggle-files').click();
  await expect(files).toBeVisible();
  await fileRow(page, 'template.typ').click();
  await expect(files).toBeHidden();
  await page.getByTestId('typst-panel-toggle-files').click();
  await expect(fileRow(page, 'template.typ')).toHaveAttribute('aria-selected', 'true');
});
