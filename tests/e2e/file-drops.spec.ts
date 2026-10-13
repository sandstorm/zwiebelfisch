// End-to-end tests (Playwright, against the demo build): project files dragged from the file panel, and files from the
// desktop dropped, into the text become what their extension makes of them, with the imports they need.
import { expect } from '@playwright/test';
import { test, fileRow } from './fixtures';

test("a spreadsheet dragged from the file panel into the simple example's text becomes its figure, with its import", async ({ page }) => {
  await page.goto('/');
  // it imports three packages: drafting, cheq and merman
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await fileRow(page, 'data').click();
  const visual = page.locator('[data-testid=zwf-visual]:visible');
  const paragraph = visual.locator('p', { hasText: 'Typst is a markup language for documents' });
  await fileRow(page, 'data/budget.ic').dragTo(paragraph);

  // the figure goes after the paragraph it was dropped on
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.locator('[data-testid=zwf-source]:visible');
  // the import above everything: before it, `sheets` is not bound yet
  await expect(source.locator('.cm-line').first()).toHaveText('#import "data/budget.ic.gen.typ": sheets');
  await expect(source).toContainText('and `backticks` show code.#figure(sheets.Budget, caption: [ ])');
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
});

test('files from the desktop dropped into the Visual and the Source editor are uploaded and become what their extension makes of them', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  /** A drop's data holding the file `name` with `text`, as the browser builds it for a file from the desktop. */
  const desktopFile = (name: string, text: string) =>
    page.evaluateHandle(([fileName, content]) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], fileName));
      return transfer;
    }, [name, text] as const);

  const visual = page.locator('[data-testid=zwf-visual]:visible');
  const paragraph = visual.locator('p', { hasText: 'Typst is a markup language for documents' });
  await paragraph.dispatchEvent('drop', { dataTransfer: await desktopFile('sequence.mmd', 'sequenceDiagram\n  A->>B: hi\n') });
  await expect(fileRow(page, 'sequence.mmd')).toBeVisible();

  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.locator('[data-testid=zwf-source]:visible');
  await expect(source).toContainText('#figure(mermaid(read("sequence.mmd"), width: 100%), caption: [ ])');

  await source.locator('.cm-content').dispatchEvent('drop', { dataTransfer: await desktopFile('photo.png', 'not really a png') });
  // an image goes where the project's images are: the simple example's one is in diagrams/
  await expect(source).toContainText('#image("diagrams/photo.png")');
  await fileRow(page, 'diagrams').click();
  await expect(fileRow(page, 'diagrams/photo.png')).toBeVisible();
});
