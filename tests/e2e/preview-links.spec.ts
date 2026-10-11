// End-to-end tests (Playwright, against the demo build): following a reference scrolls the preview ("Follow cursor",
// preview-sync) to the section it leads to, from the Visual and the Source editor; not to the section's entry in the
// outline, and not left where it was.
import { expect, type Page } from '@playwright/test';
import { test, openFile } from './fixtures';
import { selectText } from './visual-helpers';

const visual = (page: Page) => page.locator('[data-testid="typst-visual"]:visible');
const preview = (page: Page) => page.getByTestId('typst-preview');
const previewPage = (page: Page, number: string) => preview(page).locator(`.typst-preview__page[data-number="${number}"]`);

/** The section the references lead to, and words of its first paragraph (drawn once: not in the outline). */
const TARGET = { path: '20_features/23_mermaid-diagrams.typ', label: 'features-mermaid-diagrams', words: 'Mermaid diagrams are text' };
/** Where the references are, and words of its first paragraph, pages before the section. */
const FROM = { path: '10_guide/01_getting-started.typ', words: 'A Typst editor for the browser' };

test.beforeEach(async ({ page }) => {
  await page.goto('/?example=docs');
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
});

/** The number of the preview page the section is drawn on: where its first paragraph's words are shaded when selected. */
async function sectionPage(page: Page): Promise<string> {
  await openFile(page, TARGET.path);
  await selectText(visual(page).locator('p', { hasText: TARGET.words }).first(), TARGET.words);
  const shaded = preview(page).locator('.typst-preview__page', { has: page.locator('.typst-preview__selection') });
  await expect(shaded).toHaveCount(1);
  return (await shaded.getAttribute('data-number'))!;
}

test('⌘/Ctrl+click on a reference in the Visual editor scrolls the preview to the section, not to the outline', async ({ page }) => {
  const number = await sectionPage(page);
  await openFile(page, FROM.path);
  // the preview follows the cursor away from the section
  await visual(page).locator('p', { hasText: FROM.words }).first().click();
  await expect(previewPage(page, number)).not.toBeInViewport();
  await visual(page).locator(`.typst-labels__ref[data-target="${TARGET.label}"]`).first().click({ modifiers: ['ControlOrMeta'] });
  await expect(previewPage(page, number)).toBeInViewport();
});

test('⌘/Ctrl+click on a reference in the Source editor scrolls the preview to the section', async ({ page }) => {
  const number = await sectionPage(page);
  await openFile(page, FROM.path);
  await page.getByRole('tab', { name: 'Source' }).click();
  const source = page.locator('[data-testid=typst-source]:visible');
  await source.locator('.cm-line', { hasText: FROM.words }).click();
  await expect(previewPage(page, number)).not.toBeInViewport();
  await source.locator('.typst-source__path', { hasText: `@${TARGET.label}` }).first().click({ modifiers: ['ControlOrMeta'] });
  await expect(source.locator('.cm-activeLine')).toContainText(`<${TARGET.label}>`);
  await expect(previewPage(page, number)).toBeInViewport();
});
