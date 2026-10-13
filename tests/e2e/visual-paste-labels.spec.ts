// End-to-end tests (Playwright, against the demo's advanced example): copy and paste in the Visual editor gives a
// label the project has already a new name, and the references in the pasted text with it.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd } from './visual-helpers';

const METHOD = '/chapters/method.typ';

const visual = (page: Page) => page.locator('[data-testid=zwf-visual]:visible');
const method = (page: Page) => () =>
  page.evaluate((path) => (window as unknown as { editor: { files: Record<string, string> } }).editor.files[path], METHOD);

test.beforeEach(async ({ page }) => {
  await page.goto(`/?example=advanced#${METHOD}`);
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
});

test('a copied figure with its label and a reference to it pastes as <…-1> and @…-1; one undo takes it back', async ({ page }) => {
  const before = await method(page)();
  // select from the paragraph referring to the figure up to the paragraph after the figure
  const data = await visual(page).evaluate((element) => {
    type Doc = { descendants(f: (node: { type: { name: string }; textContent: string; attrs: Record<string, unknown> }, pos: number) => void): void };
    const editor = (element as HTMLElement & { editor: { state: { doc: Doc }; commands: { setTextSelection(range: { from: number; to: number }): void } } }).editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.includes('its Mermaid source') && from < 0) from = pos + 1;
      if (node.type.name === 'paragraph' && node.textContent.startsWith('In code, the loop') && to < 0) to = pos;
    });
    editor.commands.setTextSelection({ from, to });
    const clipboard = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    return Object.fromEntries(clipboard.types.map((type) => [type, clipboard.getData(type)]));
  });
  expect(data['text/x-typst']).toContain('<fig:measurement>');
  expect(data['text/x-typst']).toContain('@fig:measurement shows');

  await caretAtEnd(visual(page).locator('p').last());
  await visual(page).evaluate((element, items) => {
    const clipboard = new DataTransfer();
    for (const [type, text] of Object.entries(items)) clipboard.setData(type, text);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, data);

  await expect.poll(method(page)).toContain(') <fig:measurement-1>');
  const text = await method(page)();
  expect(text).toContain('@fig:measurement-1 shows');
  // the original stays; a reference to a label not copied (the equation's) still points to it
  expect(text.match(/<fig:measurement>/g)).toHaveLength(1);
  expect(text.match(/@eq:speedup is reported/g)).toHaveLength(2);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(method(page)).toBe(before);
});
