// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): the panel
// "Find in files" shown by its key from the Visual editor, a match opened there selected, Replace all across files
// (confirmed) and its Undo, the way in from search everywhere and the file panel, and the keys the browser would
// otherwise take (print, bookmarks, tab search) kept by the editor.
import { expect, type Page } from '@playwright/test';
import { fileRow, test } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const panel = (page: Page) => editor(page).getByTestId('typst-search');
const findField = (page: Page) => panel(page).getByRole('textbox', { name: 'Find' });
const message = (page: Page) => panel(page).locator('.typst-search__message');

async function setup(page: Page): Promise<void> {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/chapters/method.typ': '= Method\n\nWe measured compile times twice.\n', '/data.csv': 'pages,seconds\n10,0.3\n' };
    el.value = '= Report\n\nCold compile times grow linearly.\n\n#include "chapters/method.typ"\n';
  });
}

/** The text of file `name` (its path's end) as the editor has it now. */
function file(page: Page, name: string): Promise<string> {
  return editor(page).evaluate((el: Editor, end) => String(Object.entries(el.files).find(([path]) => path.endsWith(end))?.[1] ?? ''), name);
}

/** The shadow root's own selection where the browser has one (Chromium), else the document's. */
function selected(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const root = document.querySelector('typst-editor')!.shadowRoot as ShadowRoot & { getSelection?(): Selection | null };
    return (root.getSelection?.() ?? document.getSelection())?.toString();
  });
}

test('⌘⇧F in the Visual editor shows the panel; typing lists the matches by file; a click selects the match in the Visual editor', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(findField(page)).toBeFocused();
  await page.keyboard.type('compile');
  await expect(message(page)).toHaveText('2 results in 2 files');
  const match = panel(page).getByRole('treeitem').filter({ hasText: 'We measured' });
  await expect(match.locator('mark')).toHaveText('compile');
  await match.click();
  await expect(editor(page).getByTestId('typst-visual').locator('h1:visible')).toHaveText('Method');
  await expect.poll(() => selected(page)).toBe('compile');
});

test('⌘⇧H shows Replace mode; Replace all asks first, replaces in both files, and Undo takes it back', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+Shift+KeyH');
  await expect(findField(page)).toBeFocused();
  await page.keyboard.type('compile');
  await panel(page).getByRole('textbox', { name: 'Replace' }).fill('build');
  await expect(panel(page).locator('.typst-search__new').first()).toHaveText('build');
  await panel(page).locator('.typst-search__replace-all').click();
  // two files: confirmed first, in a notification
  const confirm = editor(page).getByTestId('typst-notifications');
  await expect(confirm).toContainText('Replace 2 occurrences in 2 files?');
  await confirm.getByRole('button', { name: 'Replace' }).click();
  await expect(panel(page).locator('.typst-search__outcome')).toHaveText('Replaced 2 occurrences in 2 files');
  await expect.poll(() => editor(page).evaluate((el: Editor) => el.value)).toContain('Cold build times');
  await expect.poll(() => file(page, 'chapters/method.typ')).toContain('We measured build times');
  await expect(message(page)).toHaveText('No results');
  await panel(page).getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => editor(page).evaluate((el: Editor) => el.value)).toContain('Cold compile times');
  await expect.poll(() => file(page, 'chapters/method.typ')).toContain('We measured compile times');
  await expect(message(page)).toHaveText('2 results in 2 files');
});

test('search everywhere\'s "Find in files: …" row and the file panel\'s "Find in folder…" lead to the panel', async ({ page }) => {
  await setup(page);
  await editor(page).getByTestId('typst-search-everywhere').click();
  await page.keyboard.type('%measured');
  await editor(page).getByRole('option').filter({ hasText: 'Find in files: measured' }).click();
  await expect(findField(page)).toHaveValue('measured');
  await expect(message(page)).toHaveText('1 result in 1 file');
  await editor(page).getByTestId('typst-panel-toggle-files').click();
  await fileRow(editor(page), 'chapters').click({ button: 'right' });
  await editor(page).getByRole('menuitem', { name: 'Find in folder…' }).click();
  await expect(panel(page).locator('.typst-search__scope-name')).toHaveText('chapters/');
  await expect(findField(page)).toHaveValue('measured');
  await expect(message(page)).toHaveText('1 result in 1 file');
});

test('the browser does not get the keys the editor binds (print, bookmarks, tab search)', async ({ page }) => {
  await setup(page);
  // seen first (window, capture phase), checked after the editor handled them
  await page.evaluate(() => {
    const seen: KeyboardEvent[] = [];
    (window as unknown as { seen: KeyboardEvent[] }).seen = seen;
    window.addEventListener('keydown', (event) => seen.push(event), true);
  });
  const quickPick = editor(page).getByRole('combobox', { name: 'Search everywhere' });
  const keys = ['ControlOrMeta+KeyP', 'ControlOrMeta+Shift+KeyO', 'ControlOrMeta+Shift+KeyA'];
  for (const key of keys) {
    await editor(page).getByTestId('typst-visual').locator('p').first().click();
    await page.keyboard.press(key);
    await expect(quickPick).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(quickPick).toHaveCount(0);
  }
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+Shift+KeyF');
  await expect(findField(page)).toBeFocused();
  const prevented = await page.evaluate(() =>
    (window as unknown as { seen: KeyboardEvent[] }).seen.filter((event) => ['KeyP', 'KeyO', 'KeyA', 'KeyF'].includes(event.code)).map((event) => event.defaultPrevented),
  );
  expect(prevented).toEqual([true, true, true, true]);
});

test('the panel key shows and focuses the panel, and hides it again while it has the focus (Mac ⌃3, Windows Alt+3)', async ({ page }) => {
  await setup(page);
  const platform = await page.evaluate(() => navigator.platform);
  const key = /Mac/.test(platform) ? 'Control+Digit3' : /Win/.test(platform) ? 'Alt+Digit3' : null;
  test.skip(key === null, 'no panel keys on Linux: its browsers switch tabs with Alt+1 … 8');
  await editor(page).getByTestId('typst-visual').locator('p').first().click();
  await page.keyboard.press(key!);
  await expect(findField(page)).toBeFocused();
  const toggle = editor(page).getByTestId('typst-panel-toggle-search');
  await toggle.hover();
  await expect(toggle).toHaveAttribute('title', /^Find in files \(.+\)$/);
  await page.keyboard.press(key!);
  await expect(panel(page)).toBeHidden();
});
