// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): search
// everywhere opened by double Shift inside the editors and by the rail button, its groups and prefixes, and picking
// (a heading in another file, a text match, a command, a file).
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const search = (page: Page) => editor(page).getByRole('combobox', { name: 'Search everywhere' });
/** Its rows (not the options of the toolbar's Text style menu). */
const options = (page: Page) => editor(page).getByRole('dialog', { name: 'Search everywhere' }).getByRole('option');

async function setup(page: Page): Promise<void> {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/chapters/method.typ': '= Method\n\nWe measured compile times twice.\n', '/data.csv': 'pages,seconds\n10,0.3\n' };
    el.value = '= Report\n\nCold compile times grow linearly.\n\n#include "chapters/method.typ"\n';
  });
}

async function doubleShift(page: Page): Promise<void> {
  await page.keyboard.press('Shift');
  await page.keyboard.press('Shift');
}

test('double Shift in the Visual editor opens it; # narrows to headings; Enter opens the other file at the heading', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await doubleShift(page);
  await expect(search(page)).toBeFocused();
  await expect(editor(page).locator('.typst-quick-pick__hint')).toContainText('# Headings');
  await page.keyboard.type('#meth');
  await expect(options(page)).toHaveCount(1);
  await expect(options(page).first()).toContainText('Method');
  await page.keyboard.press('Enter');
  await expect(search(page)).toHaveCount(0);
  await expect(editor(page).getByTestId('typst-visual').locator('h1:visible')).toHaveText('Method');
});

test('double Shift in the Source editor; % finds text in every file and selects the match', async ({ page }) => {
  await setup(page);
  await editor(page).getByRole('tab', { name: 'Source' }).click();
  const source = editor(page).locator('[data-testid=typst-source]:visible');
  await source.locator('.cm-content').click();
  await doubleShift(page);
  await page.keyboard.type('%measured');
  const option = options(page).filter({ hasText: 'chapters/method.typ:3' });
  await expect(option).toBeVisible();
  await expect(option.locator('mark')).toHaveText('measured');
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('[data-testid=typst-source]:visible .cm-content')).toContainText('We measured compile times');
  // the shadow root's own selection where the browser has one (Chromium), else the document's
  const selected = () =>
    page.evaluate(() => {
      const root = document.querySelector('typst-editor')!.shadowRoot as ShadowRoot & { getSelection?(): Selection | null };
      return (root.getSelection?.() ?? document.getSelection())?.toString();
    });
  await expect.poll(selected).toBe('measured');
});

test('Shift held for a capital letter does not open it', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('Shift');
  await page.keyboard.press('Shift+A');
  await expect(search(page)).toHaveCount(0);
});

test('the rail button opens it over everything, grouped; / opens a file; Escape closes it', async ({ page }) => {
  await setup(page);
  const button = editor(page).getByTestId('typst-search-everywhere');
  await button.click();
  await expect(editor(page).locator('.typst-quick-pick__heading').first()).toContainText('Files');
  await page.keyboard.type('compile');
  // the headings group is empty for this query, the text group has both files
  await expect(editor(page).locator('.typst-quick-pick__heading', { hasText: 'Text' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search(page)).toHaveCount(0);
  await button.click();
  await page.keyboard.type('/data');
  await page.keyboard.press('Enter');
  await expect(editor(page).getByTestId('typst-text-file').locator('.cm-content')).toContainText('pages,seconds');
});

test('> lists the commands by title and runs the one picked', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await doubleShift(page);
  await page.keyboard.type('>number head');
  await expect(options(page).first()).toHaveText('Headings: Number headings on / off');
  await page.keyboard.press('Enter');
  await expect.poll(() => editor(page).evaluate((el: Editor) => el.value)).toContain('#set heading(numbering: "1.")');
});
