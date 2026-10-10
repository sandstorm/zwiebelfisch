// End-to-end tests (Playwright, against the demo build): the <typst-editor> element from the library build.
import { test, expect } from './fixtures';

// examples/plain-html loads dist/lib/typst-editor.js without any bundler.
test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
});

test('renders the inline Typst source of <typst-editor>', async ({ page }) => {
  const editor = page.locator('typst-editor');
  // Playwright locators pierce the open shadow root.
  await expect(editor.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await expect(editor.getByTestId('typst-source')).toContainText('= Plain HTML');
  // the common indentation of the HTML is removed
  expect(await editor.evaluate((el: HTMLElement & { value: string }) => el.value.startsWith('#set page'))).toBe(true);
});

test('keeps its styles inside the shadow root', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await expect(editor.getByTestId('typst-preview')).toBeVisible();
  expect(await page.locator('head #typst-editor-styles').count()).toBe(0);
  const inShadow = await editor.evaluate((el) => el.shadowRoot!.querySelector('#typst-editor-styles') !== null);
  expect(inShadow).toBe(true);
});

test('dispatches change with the path and new content of the edited file while typing', async ({ page }) => {
  const editor = page.locator('typst-editor');
  // one change per keystroke: the last one carries all of the typed text
  await editor.evaluate((el) => {
    const changes: { path: string; content: unknown }[] = [];
    (el as HTMLElement & { changes: typeof changes }).changes = changes;
    el.addEventListener('change', (event) => changes.push((event as CustomEvent<{ path: string; content: unknown }>).detail));
  });
  const changes = () => editor.evaluate((el) => (el as HTMLElement & { changes: { path: string; content: unknown }[] }).changes);
  await editor.getByRole('tab', { name: 'Source' }).click();
  await editor.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('More text.');
  await expect.poll(async () => (await changes()).at(-1)?.content).toContain('More text.');
  expect((await changes()).length).toBeGreaterThan(1);
  expect((await changes()).every((change) => change.path === '/main.typ')).toBe(true);
  await expect(page.getByTestId('length')).not.toHaveText('');
});

test('setting the value property updates the preview without a change event', async ({ page }) => {
  const editor = page.locator('typst-editor');
  const preview = editor.getByTestId('typst-preview');
  await expect(preview.locator('.typst-preview__page')).toHaveCount(1);
  const changes = await editor.evaluate((el: HTMLElement & { value: string }) => {
    let count = 0;
    el.addEventListener('change', () => count++);
    el.value = `${el.value}\n#pagebreak()\nSecond page`;
    return count;
  });
  expect(changes).toBe(0);
  await expect(preview.locator('.typst-preview__page')).toHaveCount(2);
  await expect(editor.getByTestId('typst-source')).toContainText('Second page');
});

test('the value attribute replaces the source', async ({ page }) => {
  const editor = page.locator('typst-editor');
  await editor.evaluate((el) => el.setAttribute('value', '= From attribute\n'));
  await expect(editor.getByTestId('typst-source').locator('.cm-content')).toHaveText('= From attribute');
});
