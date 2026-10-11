// End-to-end tests (Playwright, against the demo build): project files dragged from the file panel into the text
// become what their extension makes of them, with the imports they need.
import { expect } from '@playwright/test';
import { test, fileRow } from './fixtures';

test("a spreadsheet dragged from the file panel into the simple example's text becomes its figure, with its import", async ({ page }) => {
  await page.goto('/');
  // it imports three packages: drafting, cheq and merman
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await fileRow(page, 'data').click();
  const visual = page.locator('[data-testid=typst-visual]:visible');
  const paragraph = visual.locator('p', { hasText: 'Typst is a markup language for documents' });
  await fileRow(page, 'data/budget.ic').dragTo(paragraph);

  // the figure goes after the paragraph it was dropped on
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.locator('[data-testid=typst-source]:visible');
  // the import above everything: before it, `sheets` is not bound yet
  await expect(source.locator('.cm-line').first()).toHaveText('#import "data/budget.ic.gen.typ": sheets');
  await expect(source).toContainText('and `backticks` show code.#figure(sheets.Budget, caption: [ ])');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});
