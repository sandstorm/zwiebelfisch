// End-to-end tests (Playwright, against the demo build): copy and paste in the Visual editor, in Typst.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, compiled, selectText, sourceText, visual } from './visual-helpers';

const FIGURE = '#figure(\n  rect(width: 2cm),\n  caption: [A box],\n)';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await compiled(page);
});

/** Pastes `items` (type → text) into the Visual editor, as the browser would (a paste event with that data). */
async function paste(page: Page, items: Record<string, string>): Promise<void> {
  await visual(page).evaluate((element, items) => {
    const data = new DataTransfer();
    for (const [type, text] of Object.entries(items)) data.setData(type, text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, items);
}

/** Copies the selection of the Visual editor: what a copy event puts on the clipboard, by type. */
async function copy(page: Page): Promise<Record<string, string>> {
  return visual(page).evaluate((element) => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
    return Object.fromEntries(data.types.map((type) => [type, data.getData(type)]));
  });
}

test('pasted Typst text is read as Typst: a figure stays a figure, in one undo step', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  const before = await sourceText(page)();
  await paste(page, { 'text/plain': FIGURE });
  await expect.poll(sourceText(page)).toContain(`\n${FIGURE}\n`);
  await expect(visual(page).locator('figure, .typst-visual__raw-block', { hasText: 'A box' }).first()).toBeVisible();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(sourceText(page)).toBe(before);
});

test('pasted inline Typst goes into the text; Mod+Shift+V pastes the characters', async ({ page }) => {
  await caretAtEnd(visual(page).locator('p').first());
  await paste(page, { 'text/plain': ' *pasted*' });
  await expect(visual(page).locator('strong', { hasText: 'pasted' })).toBeVisible();
  // a synthetic key: a real Mod+Shift+V would also paste the system clipboard
  await visual(page).evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', code: 'KeyV', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true })),
  );
  await paste(page, { 'text/plain': ' *plain*' });
  await expect.poll(sourceText(page)).toContain('*pasted* \\*plain\\*');
});

test('copy puts the Typst of the selection on the clipboard; pasting it reads it back', async ({ page }) => {
  // the demo's first paragraph: "… *stars* make text strong …"
  await selectText(visual(page).locator('p').first(), 'stars');
  const data = await copy(page);
  expect(data['text/plain']).toBe('*stars*');
  expect(data['text/x-typst']).toBe('*stars*');
  expect(data['text/html']).toContain('<strong>stars</strong>');
  await caretAtEnd(visual(page).locator('p').first());
  await paste(page, data);
  await expect(visual(page).locator('p').first().locator('strong', { hasText: 'stars' })).toHaveCount(2);
});

const MERMAID = '#figure(mermaid("flowchart LR\\n  A --> B"), caption: [Flow])';

/** Makes the main file `text` (the demo's imports merman already) and waits until the Visual editor shows it. */
async function setSource(page: Page, text: string, shown: string): Promise<void> {
  await page.evaluate((value) => ((window as unknown as { editor: { source: string } }).editor.source = value), text);
  await expect(visual(page).locator('p', { hasText: shown })).toBeVisible();
}

test('pasted Typst gets the imports its names need, in the same undo step', async ({ page }) => {
  await setSource(page, '= Imports\n\nSome text.\n', 'Some text.');
  await caretAtEnd(visual(page).locator('p').first());
  const before = await sourceText(page)();
  await paste(page, { 'text/plain': MERMAID });
  await expect.poll(sourceText(page)).toMatch(/^#import "@preview\/merman:0\.4\.0": mermaid\n/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(sourceText(page)).toBe(before);
});

test('the Source editor adds the imports of a paste too', async ({ page }) => {
  await setSource(page, '= Imports\n\nSome text.\n', 'Some text.');
  await page.getByRole('tab', { name: 'Source' }).click();
  const content = page.getByTestId('typst-source').locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+End');
  await content.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, `\n${MERMAID}\n`);
  await expect.poll(sourceText(page)).toMatch(/^#import "@preview\/merman:0\.4\.0": mermaid\n[^]*#figure\(mermaid/);
});
