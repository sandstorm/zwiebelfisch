// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): the Insert
// entries that make a new file and put it into the text as a figure — a spreadsheet (Insert menu), a draw.io diagram
// and a Mermaid diagram (slash commands) — each opened in its editor afterwards. diagrams.net itself is not loaded: a
// stub page at its URL only says it is ready.
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

const editor = (page: Page) => page.locator('typst-editor');
const visual = (page: Page) => editor(page).getByTestId('typst-visual');
const value = (page: Page) => () => editor(page).evaluate((el: Editor) => el.value);
const fileText = (page: Page, path: string) => () =>
  editor(page).evaluate((el: Editor, path) => {
    const file = el.files[path];
    return file === undefined ? null : typeof file === 'string' ? file : new TextDecoder().decode(file);
  }, path);

test.beforeEach(async ({ page }) => {
  await page.route('https://embed.diagrams.net/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: "<p id=status>stub</p><script>parent.postMessage(JSON.stringify({ event: 'init' }), '*')</script>" }),
  );
  await page.goto('/examples/plain-html/');
  await expect(editor(page).getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
  await editor(page).evaluate((el: Editor) => {
    el.value = '= Results\n\nThe runs:\n';
  });
  await expect(visual(page).locator('p')).toHaveText('The runs:');
});

/** Puts the caret at the end of the Visual editor's paragraph. */
async function caretInParagraph(page: Page): Promise<void> {
  await visual(page).locator('p').click();
  await page.keyboard.press('End');
}

/** Accepts the name the save dialog `title` proposes, after checking it. */
async function acceptName(page: Page, title: string, proposed: string): Promise<void> {
  const name = editor(page).getByRole('form', { name: title }).getByRole('textbox');
  await expect(name).toHaveValue(proposed);
  await name.press('Enter');
}

test('Insert → Insert spreadsheet: a new .ic with a starter table, its table as a figure, the document compiles, IronCalc opens', async ({ page }) => {
  await caretInParagraph(page);
  await editor(page).getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name: 'Insert', exact: true }).click();
  await editor(page).getByRole('menuitem', { name: 'Insert spreadsheet' }).click();
  await acceptName(page, 'Insert spreadsheet', 'data/table.ic');

  await expect(editor(page).getByTestId('typst-spreadsheet').locator('.ic-root')).toBeVisible();
  await expect.poll(fileText(page, '/data/table.ic.gen.typ')).toContain('("Item", "Value")');
  await expect.poll(value(page)).toBe('#import "data/table.ic.gen.typ": sheets\n\n= Results\n\nThe runs:\n\n#figure(sheets.Sheet1, caption: [ ])\n');
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
});

test('/diagram: a new .drawio.png as a figure, opened in the diagram editor', async ({ page }) => {
  await caretInParagraph(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/diagram');
  await page.keyboard.press('Enter');
  await acceptName(page, 'Insert diagram', 'diagrams/diagram.drawio.png');

  await expect(editor(page).getByTestId('typst-diagram').frameLocator('iframe').locator('#status')).toHaveText('stub');
  await expect.poll(value(page)).toBe('= Results\n\nThe runs:\n\n#figure(image("diagrams/diagram.drawio.png"), caption: [ ])\n');
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
});

test('/mermaid: a new .mmd with a starter flowchart as a figure with the merman import, opened in the text editor; ⌘/Ctrl+click on its picture ("Edit diagram") opens it again', async ({ page }) => {
  await caretInParagraph(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/mermaid');
  await page.keyboard.press('Enter');
  await acceptName(page, 'Insert Mermaid diagram', 'diagrams/diagram.mmd');

  const text = editor(page).getByTestId('typst-text-file');
  await expect(text.locator('.cm-content')).toContainText('flowchart LR');
  await expect.poll(value(page)).toBe(
    '#import "@preview/merman:0.4.0": mermaid\n\n= Results\n\nThe runs:\n\n#figure(mermaid(read("diagrams/diagram.mmd"), width: 100%), caption: [ ])\n',
  );
  // the merman package is downloaded from packages.typst.org
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/, { timeout: 30_000 });

  await editor(page).getByTestId('typst-files').locator('[role=treeitem][title="main.typ"]').click();
  const picture = visual(page).locator('.typst-visual__raw-block', { hasText: 'diagram.mmd' }).locator('img.typst-visual__rendering');
  await picture.hover();
  await expect(page.getByRole('tooltip')).toHaveText(/^Edit diagram\s*\(/);
  await picture.click({ modifiers: ['ControlOrMeta'] });
  await expect(text.locator('.cm-content')).toContainText('flowchart LR');
});
