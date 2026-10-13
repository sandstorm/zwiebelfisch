// End-to-end tests (Playwright, against the Vite dev server, not the static build): the Documentation example saves
// edits to docs/ and shows changes made there. Needs the dev server: mise run test:e2e-docs. Restores the file.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.ZWF_DOCS_E2E, 'needs the dev server: mise run test:e2e-docs');

const DEV_SERVER = 'http://127.0.0.1:5199';
const FILE = resolve(import.meta.dirname, '../../docs/10_getting-started/01_getting-started.typ');
const saveStatus = (page: Page) => page.getByTestId('save-status');

let original: string;

test.beforeEach(async () => {
  original = await readFile(FILE, 'utf8');
});

test.afterEach(async () => {
  await writeFile(FILE, original);
});

async function openGettingStarted(page: Page): Promise<void> {
  await page.goto(`${DEV_SERVER}/?example=docs#/10_getting-started/01_getting-started.typ`);
  await expect(saveStatus(page)).toHaveText('Edits are saved to docs/');
  await page.locator('[role=tab]:visible', { hasText: 'Source' }).click();
}

const sourceLine = (page: Page, text: string) => page.locator('[data-testid=zwf-source]:visible .cm-line', { hasText: text });

test('an edited heading is saved to the file in docs/', async ({ page }) => {
  await openGettingStarted(page);
  await sourceLine(page, '= Getting started <getting-started>').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('E2E ');
  await expect.poll(() => readFile(FILE, 'utf8')).toContain('= E2E Getting started <getting-started>');
  await expect(saveStatus(page)).toHaveText('Saved to docs/10_getting-started/01_getting-started.typ');
  // the rest of the file is untouched
  expect((await readFile(FILE, 'utf8')).replace('E2E ', '')).toBe(original);
});

test('a change of the file on disk (another editor, git) shows up in the editor', async ({ page }) => {
  await openGettingStarted(page);
  await writeFile(FILE, original.replace('= Getting started', '= Started elsewhere'));
  await expect(sourceLine(page, '= Started elsewhere <getting-started>')).toBeVisible();
  await expect(saveStatus(page)).toHaveText('Updated docs/10_getting-started/01_getting-started.typ from disk');
});
