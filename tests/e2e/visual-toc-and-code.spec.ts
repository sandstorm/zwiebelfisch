// End-to-end tests (Playwright, against the demo build): outlines and code blocks in the Visual editor.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { caretAtEnd, chooseFrom, selectionBar, selectText } from './visual-helpers';

type Editor = HTMLElement & { value: string };

test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

async function load(page: Page, value: string) {
  await page.locator('typst-editor').evaluate((el: Editor, text) => (el.value = text), value);
}

const visual = (page: Page) => page.getByTestId('typst-visual');
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const value = (page: Page) => () => page.locator('typst-editor').evaluate((el: Editor) => el.value);

test('a code block shows its language and text; typing edits the code in place', async ({ page }) => {
  await load(page, 'Intro\n\n```rust\nfn main() {}\n```\n');
  const block = visual(page).locator('.typst-markup__code-block');
  await expect(block.getByLabel('Language')).toHaveValue('rust');
  await expect(block.locator('pre code')).toHaveText('fn main() {}');
  await caretAtEnd(block.locator('pre code'));
  await page.keyboard.type(' // ok *');
  await expect.poll(value(page)).toBe('Intro\n\n```rust\nfn main() {} // ok *\n```\n');
});

test('the language field changes the fence tag', async ({ page }) => {
  await load(page, 'Intro\n\n```rust\nfn main() {}\n```\n');
  const field = visual(page).getByLabel('Language');
  await field.fill('python');
  await expect.poll(value(page)).toBe('Intro\n\n```python\nfn main() {}\n```\n');
  await field.press('Enter');
  await page.keyboard.type('x');
  await expect.poll(value(page)).toBe('Intro\n\n```python\nxfn main() {}\n```\n');
});

test('Code block turns the current paragraph into a fenced block', async ({ page }) => {
  await load(page, 'Intro\n\nlet a = 1\n');
  await visual(page).locator('p', { hasText: 'let a = 1' }).click();
  await chooseFrom(toolbar(page), 'Insert', 'Code block');
  await expect(visual(page).locator('.typst-markup__code-block pre code')).toHaveText('let a = 1');
  await expect.poll(value(page)).toBe('Intro\n\n```\nlet a = 1\n```\n');
});

test('Code marks the selection as inline code, printed in backticks', async ({ page }) => {
  await load(page, 'Call print now\n');
  const paragraph = visual(page).locator('p').first();
  await selectText(paragraph, 'print');
  await selectionBar(page).getByRole('button', { name: 'Code', exact: true }).click();
  await expect(paragraph.locator('code')).toHaveText('print');
  await expect.poll(value(page)).toBe('Call `print` now\n');
});

test('inline code from the source is edited as text and keeps its delimiters', async ({ page }) => {
  await load(page, 'Use ```js x``` here\n');
  const code = visual(page).locator('p code');
  await expect(code).toHaveText('x');
  await caretAtEnd(code); // not End: that goes to the end of the line, past the code
  await page.keyboard.type('y');
  await expect.poll(value(page)).toBe('Use ```js xy``` here\n');
});

test('Table of contents inserts #outline(), shown compiled with its label', async ({ page }) => {
  await load(page, '= Intro\n\nText\n\n= Details\n');
  await caretAtEnd(visual(page).locator('p', { hasText: 'Text' }));
  await chooseFrom(toolbar(page), 'Insert', 'Table of contents');
  await expect.poll(value(page)).toBe('= Intro\n\nText\n\n#outline()\n\n= Details\n');
  const box = visual(page).locator('.typst-outline__box');
  await expect(box.locator('.typst-visual__box-label')).toHaveText('Table of contents');
  await expect(box.locator('img.typst-visual__rendering')).toBeVisible();
});
