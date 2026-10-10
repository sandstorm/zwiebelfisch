// End-to-end tests (Playwright, against the plain-HTML example, so inside <typst-editor>'s shadow root): a
// `.drawio.png` made with "New diagram…", edited in the embedded editor, saved without pressing Save, shown by Typst.
// diagrams.net itself is not loaded: a stub page at its URL speaks the embed protocol (init, load, autosave,
// export as xmlpng), drawing a bigger rectangle on every "Draw".
import { expect, type Page } from '@playwright/test';
import { test, fileRow } from './fixtures';

type Editor = HTMLElement & { value: string; files: Record<string, string | Uint8Array> };

/** diagrams.net in embed mode, as far as the widget uses it. */
const STUB = `<!doctype html>
<html><body>
<p id="status">waiting</p><button id="draw">Draw</button>
<canvas id="canvas" width="200" height="100"></canvas>
<script>
  let shapes = 0;
  const xml = () => '<mxfile><diagram name="Page-1">' + shapes + ' shapes</diagram></mxfile>';
  const send = (message) => parent.postMessage(JSON.stringify(message), '*');
  addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.action === 'load') {
      document.getElementById('status').textContent = 'loaded ' + (message.xmlpng ? 'xmlpng' : 'xml') + ' autosave=' + message.autosave;
    } else if (message.action === 'export' && message.format === 'xmlpng') {
      const canvas = document.getElementById('canvas');
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, 200, 100);
      context.fillStyle = 'teal';
      context.fillRect(0, 0, 20 * shapes, 50);
      send({ event: 'export', format: 'xmlpng', xml: xml(), data: canvas.toDataURL('image/png'), message });
    }
  });
  document.getElementById('draw').addEventListener('click', () => {
    shapes += 1;
    send({ event: 'autosave', xml: xml() });
  });
  send({ event: 'init' });
</script>
</body></html>`;

const editor = (page: Page) => page.locator('typst-editor');
const diagramBytes = (page: Page) => () =>
  editor(page).evaluate((el: Editor) => {
    const file = el.files['/flow.drawio.png'];
    return file instanceof Uint8Array ? file.length : -1;
  });
const previewImage = (page: Page) => editor(page).getByTestId('typst-preview').locator('.typst-preview__page image');
/** The picture the preview shows (its data URL is in `href` or `xlink:href`). */
const previewPicture = (page: Page) => () => previewImage(page).evaluate((image) => image.outerHTML);

test.beforeEach(async ({ page }) => {
  await page.route('https://embed.diagrams.net/**', (route) => route.fulfill({ contentType: 'text/html', body: STUB }));
  await page.goto('/examples/plain-html/');
  await expect(editor(page).getByTestId('typst-preview').locator('.typst-preview__page svg')).toBeVisible();
});

/** A document showing `flow.drawio.png` (and a second file, so the file panel is open), the diagram made with "New diagram…". */
async function newDiagram(page: Page): Promise<void> {
  await editor(page).evaluate((el: Editor) => {
    el.files = { '/notes.typ': 'Notes\n' };
    el.value = '#image("flow.drawio.png", width: 4cm)\n';
  });
  await editor(page).getByTestId('typst-files').getByRole('button', { name: 'New' }).click();
  await editor(page).getByRole('menuitem', { name: 'New diagram…' }).click();
  const name = editor(page).getByRole('form', { name: 'New diagram' }).getByRole('textbox');
  await name.fill('flow');
  await name.press('Enter');
}

test('"New diagram…" opens the embedded editor; drawing saves the .drawio.png without Save, and the preview shows it', async ({ page }) => {
  await newDiagram(page);

  await expect(fileRow(editor(page), 'flow.drawio.png')).toBeVisible();
  const empty = await diagramBytes(page)();
  expect(empty).toBeGreaterThan(0);
  const stub = editor(page).getByTestId('typst-diagram').frameLocator('iframe');
  await expect(stub.locator('#status')).toHaveText('loaded xmlpng autosave=1');
  await expect(editor(page).getByTestId('typst-status')).toHaveText(/✓/);
  await expect(previewImage(page)).toHaveCount(1);
  const before = await previewPicture(page)();

  await stub.getByRole('button', { name: 'Draw' }).click();
  await stub.getByRole('button', { name: 'Draw' }).click();
  await expect.poll(diagramBytes(page)).not.toBe(empty);
  await expect.poll(previewPicture(page)).not.toBe(before);
});

test('"Edit diagram" on the image box opens the diagram; a change is saved when the file is closed right away', async ({ page }) => {
  await newDiagram(page);
  const stub = editor(page).getByTestId('typst-diagram').frameLocator('iframe');
  await expect(stub.locator('#status')).toHaveText(/^loaded/);
  const empty = await diagramBytes(page)();

  // drawn, then the main file opened at once (before the save delay): the pending save is flushed
  await stub.getByRole('button', { name: 'Draw' }).click();
  await fileRow(editor(page), 'main.typ').click();
  await expect.poll(diagramBytes(page)).not.toBe(empty);

  const box = editor(page).getByTestId('typst-visual').locator('.typst-visual__image');
  await box.locator('img.typst-visual__rendering').click();
  await box.getByRole('toolbar', { name: 'Image' }).getByRole('button', { name: 'Edit diagram' }).click();
  await expect(editor(page).getByTestId('typst-diagram').frameLocator('iframe').locator('#status')).toHaveText(/^loaded/);
});
