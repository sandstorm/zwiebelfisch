// End-to-end tests (Playwright, against the demo build): spell checking in the Visual editor by the browser's own
// checker (the spellcheck and lang attributes; the browser's underlines cannot be asserted).
import { test } from './fixtures';
import { expect, type Page } from '@playwright/test';
import { visual } from './visual-helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

type Editor = { source: string; settings: Record<string, unknown> };
const setSource = (page: Page, text: string) => page.evaluate((t) => ((window as unknown as { editor: Editor }).editor.source = t), text);
const setSettings = (page: Page, settings: Record<string, unknown>) =>
  page.evaluate((s) => ((window as unknown as { editor: Editor }).editor.settings = s), settings);

test('the Visual editor is spell-checked in the language of set text, code is not', async ({ page }) => {
  await setSource(page, '#set text(lang: "de", region: "AT")\n\nServus mit `kode`.\n');
  await expect(visual(page)).toHaveAttribute('spellcheck', 'true');
  await expect(visual(page)).toHaveAttribute('lang', 'de-AT');
  await expect(visual(page).locator('code', { hasText: 'kode' })).toHaveAttribute('spellcheck', 'false');
  await expect(page.getByTestId('typst-visual').locator('.cm-content').first()).toHaveAttribute('spellcheck', 'false');
});

test('the setting spellcheck.enabled turns it off and on', async ({ page }) => {
  await setSettings(page, { 'spellcheck.enabled': false });
  await expect(visual(page)).toHaveAttribute('spellcheck', 'false');
  await setSettings(page, {});
  await expect(visual(page)).toHaveAttribute('spellcheck', 'true');
});
