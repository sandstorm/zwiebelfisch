// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): a `.bib` opened
// in the text editor (plain CodeMirror), edited, saved without pressing Save, and cited by the document.
import { expect, type Page } from '@playwright/test';
import { test, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const fileText = (page: Page, path: string) => () =>
  editor(page).evaluate((el: Editor, path) => {
    const file = el.files[path];
    return file === undefined ? null : typeof file === 'string' ? file : new TextDecoder().decode(file);
  }, path);

test('a .bib opens in the text editor; an added entry is saved and the document can cite it', async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/refs.bib': '@book{lamport, title = {LaTeX}, author = {Lamport, Leslie}, year = {1986}}\n' };
    el.value = 'As @knuth shows.\n\n#bibliography("refs.bib")\n';
  });
  // @knuth is not in the bibliography yet
  await expect(editor(page).getByTestId('typst-status')).not.toHaveText(/✓/);
  await fileRow(editor(page), 'refs.bib').click();

  const text = editor(page).getByTestId('typst-text-file');
  await expect(text.getByRole('heading', { name: 'refs.bib' })).toBeVisible();
  await expect(text.locator('.cm-content')).toContainText('@book{lamport');
  await text.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  // closing brackets are typed over the ones CodeMirror closes by itself
  await page.keyboard.type('@book{knuth, title = {The TeXbook}, author = {Knuth, Donald}, year = {1984}}');
  await expect.poll(fileText(page, '/refs.bib')).toContain('@book{knuth, title = {The TeXbook}, author = {Knuth, Donald}, year = {1984}}');
  expect(await fileText(page, '/refs.bib')()).toContain('@book{lamport');
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
});

test('a change of the file from the host shows up in the open text editor', async ({ page }) => {
  await page.goto('/examples/plain-html/');
  await expect(page.getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/data.csv': 'a,b\n' };
  });
  await fileRow(editor(page), 'data.csv').click();
  const content = editor(page).getByTestId('typst-text-file').locator('.cm-content');
  await expect(content).toContainText('a,b');
  await editor(page).evaluate((el: Editor) => {
    el.files = { ...el.files, '/data.csv': 'a,b\n1,2\n' };
  });
  await expect(content).toContainText('1,2');
});
