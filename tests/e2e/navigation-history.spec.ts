// End-to-end tests (Playwright, against the demo build): "← Back to …" / "Forward to … →" after following a link
// (the file-navigation extension), by click and by VS Code's keys.
import { expect } from '@playwright/test';
import { test, fileRow, openFile } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.goto('/?example=advanced');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});

test('following the link to an .mmd offers the way back; back restores the Source view at the link, forward returns', async ({ page }) => {
  const history = page.locator('nav.typst-file-navigation--history:visible');
  await expect(history).toHaveCount(0);
  await openFile(page, 'chapters/method.typ');
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.locator('[data-testid=typst-source]:visible');
  const path = source.locator('.typst-source__path', { hasText: 'measurement.mmd' });
  await path.click(); // the caret on the link's line
  await path.click({ modifiers: ['ControlOrMeta'] });

  const text = page.getByTestId('typst-text-file');
  await expect(fileRow(page, 'diagrams/measurement.mmd')).toHaveAttribute('aria-selected', 'true');
  await expect(text.locator('.cm-content')).toBeVisible();
  await expect(history.getByRole('button')).toHaveText(['← Back to chapters/method.typ']);

  await history.getByRole('button', { name: '← Back to chapters/method.typ' }).click();
  await expect(fileRow(page, 'chapters/method.typ')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true');
  await expect(source.locator('.cm-activeLine')).toContainText('measurement.mmd');
  await expect(history.getByRole('button', { name: 'Forward to diagrams/measurement.mmd →' })).toBeVisible();

  await page.keyboard.press('Control+Shift+Minus');
  await expect(fileRow(page, 'diagrams/measurement.mmd')).toHaveAttribute('aria-selected', 'true');
  await text.locator('.cm-content').click(); // keys go to the widget only while the focus is in it
  const mac = await page.evaluate(() => /Mac/.test(navigator.platform));
  await page.keyboard.press(mac ? 'Control+Minus' : 'Control+Alt+Minus');
  await expect(fileRow(page, 'chapters/method.typ')).toHaveAttribute('aria-selected', 'true');
});
