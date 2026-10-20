// End-to-end tests (Playwright, against the demo build): the <zwiebelfisch-editor> element from the library build.
import { expect } from '@playwright/test';
import { test } from './fixtures';

// examples/plain-html loads dist/lib/zwiebelfisch.js without any bundler.
test.beforeEach(async ({ page }) => {
  await page.goto('/examples/plain-html/');
});

test('renders the inline Typst source of <zwiebelfisch-editor>', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  // Playwright locators pierce the open shadow root.
  await expect(editor.getByTestId('zwf-preview').locator('.zwf-preview__page svg')).toBeVisible();
  // the Source editor is made when first shown
  await editor.getByRole('tab', { name: 'Source' }).click();
  await expect(editor.getByTestId('zwf-source')).toContainText('= Plain HTML');
  // the common indentation of the HTML is removed
  expect(await editor.evaluate((el: HTMLElement & { value: string }) => el.value.startsWith('#set page'))).toBe(true);
});

test('keeps its styles inside the shadow root', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  await expect(editor.getByTestId('zwf-preview')).toBeVisible();
  expect(await page.locator('head #zwf-editor-styles').count()).toBe(0);
  const inShadow = await editor.evaluate((el) => el.shadowRoot!.querySelector('#zwf-editor-styles') !== null);
  expect(inShadow).toBe(true);
});

test('dispatches change with the path and new content of the edited file while typing', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  // one change per keystroke: the last one carries all of the typed text
  await editor.evaluate((el) => {
    const changes: { path: string; content: unknown }[] = [];
    (el as HTMLElement & { changes: typeof changes }).changes = changes;
    el.addEventListener('change', (event) => changes.push((event as CustomEvent<{ path: string; content: unknown }>).detail));
  });
  const changes = () => editor.evaluate((el) => (el as HTMLElement & { changes: { path: string; content: unknown }[] }).changes);
  await editor.getByRole('tab', { name: 'Source' }).click();
  await editor.getByTestId('zwf-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('More text.');
  await expect.poll(async () => (await changes()).at(-1)?.content).toContain('More text.');
  expect((await changes()).length).toBeGreaterThan(1);
  expect((await changes()).every((change) => change.path === '/main.typ')).toBe(true);
  await expect(page.getByTestId('length')).not.toHaveText('');
});

test('setting the value property updates the preview without a change event', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  const preview = editor.getByTestId('zwf-preview');
  await expect(preview.locator('.zwf-preview__page')).toHaveCount(1);
  const changes = await editor.evaluate((el: HTMLElement & { value: string }) => {
    let count = 0;
    el.addEventListener('change', () => count++);
    el.value = `${el.value}\n#pagebreak()\nSecond page`;
    return count;
  });
  expect(changes).toBe(0);
  await expect(preview.locator('.zwf-preview__page')).toHaveCount(2);
  await editor.getByRole('tab', { name: 'Source' }).click();
  await expect(editor.getByTestId('zwf-source')).toContainText('Second page');
});

test('maps the settings attribute onto the settings, also when it changes', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  const widget = editor.locator('.zwf-editor');
  const toolbar = editor.getByTestId('zwf-preview-toolbar');
  await expect(widget).toHaveAttribute('data-theme', 'light');
  await expect(toolbar.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await page.getByTestId('dark').check();
  await expect(widget).toHaveAttribute('data-theme', 'dark');
  await expect(widget).toHaveAttribute('data-scheme', 'dark');
  await page.getByTestId('pdf').uncheck();
  await expect(toolbar.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
  await page.getByTestId('pdf').check();
  // back in its place: at the end
  await expect(toolbar.locator('button').last()).toHaveAttribute('data-command', 'pdfExport.download');
  expect(await editor.evaluate((el: HTMLElement & { settings: object }) => el.settings)).toEqual({
    'workbench.theme': 'dark',
    'pdfExport.download': true,
  });
  // files.panel: hide — no file panel, no rail button
  await expect(editor.getByTestId('zwf-panel-toggle-files')).toBeVisible();
  await editor.evaluate((el) => el.setAttribute('settings', '{"files.panel": "hide"}'));
  await expect(editor.getByTestId('zwf-panel-toggle-files')).toBeHidden();
});

test('runs commands of the extensions', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  await expect(editor.getByTestId('zwf-preview').locator('.zwf-preview__page svg')).toBeVisible();
  const type = await editor.evaluate(async (el: HTMLElement & { executeCommand(id: string, ...args: unknown[]): Promise<Blob> }) => {
    const blob = await el.executeCommand('pdfExport.export');
    return blob.type;
  });
  expect(type).toBe('application/pdf');
});

test('the value attribute replaces the source', async ({ page }) => {
  const editor = page.locator('zwiebelfisch-editor');
  await editor.evaluate((el) => el.setAttribute('value', '= From attribute\n'));
  await editor.getByRole('tab', { name: 'Source' }).click();
  await expect(editor.getByTestId('zwf-source').locator('.cm-content')).toHaveText('= From attribute');
});
