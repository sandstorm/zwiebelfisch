// End-to-end tests (Playwright, against the demo build): the widget over a slow connection — the text first, editable,
// then what the preview still loads (in its pane only, not in the status bar), then the pages.
// Requests are held back until the test lets them through.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, type Route } from '@playwright/test';
import { test } from './fixtures';
import { selectText } from './visual-helpers';

const PACKAGES = resolve(import.meta.dirname, '../../.cache/typst-packages');

/** Holds back the requests `url` matches until `release()`, then lets `serve` answer them (default: the fixture's server). */
async function holdBack(page: Page, url: string | RegExp, serve: (route: Route) => Promise<void> = (route) => route.fallback()) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const held: string[] = [];
  await page.route(url, async (route) => {
    held.push(route.request().url());
    await released;
    await serve(route);
  });
  return { release, held };
}

const preview = (page: Page) => page.getByTestId('zwf-preview');
const loader = (page: Page) => page.getByTestId('zwf-preview-progress');

test('the text shows and takes typing before the compiler is there; the preview says it loads it, then shows the pages', async ({ page }) => {
  const wasm = await holdBack(page, /\.wasm$/);
  await page.goto('/');
  await expect(page.getByTestId('zwf-visual').locator('h1')).toHaveText('Typst in five minutes');
  await expect(loader(page).getByRole('status')).toHaveText('Loading the Typst compiler…');
  await expect(loader(page).getByRole('progressbar')).toBeVisible();

  await page.getByRole('tab', { name: 'Source' }).click();
  await page.getByTestId('zwf-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nTyped while the compiler loads');
  await expect(page.getByTestId('zwf-source')).toContainText('Typed while the compiler loads');
  await expect(preview(page).locator('.zwf-preview__page')).toHaveCount(0);
  expect(wasm.held).toHaveLength(1);

  wasm.release();
  await expect(preview(page).locator('.zwf-preview__page svg').first()).toBeVisible();
  await expect(loader(page)).toBeHidden();
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/);
});

test('the Visual editor takes typing while the compiler loads; raw boxes show their code until their pictures come', async ({ page }) => {
  const wasm = await holdBack(page, /\.wasm$/);
  await page.goto('/');
  const visual = page.getByTestId('zwf-visual');
  // the equation is a raw box: its code first
  const equation = visual.locator('.zwf-visual__raw-block', { hasText: 'integral_0^1' });
  await expect(equation.locator('.zwf-visual__code')).toContainText('integral_0^1');
  await expect(equation.locator('img.zwf-visual__rendering')).toBeHidden();
  // the caret set as a selection the editor has taken (a bare click races its focus handling while the page loads)
  await selectText(visual.locator('h1'), 'minutes');
  await page.keyboard.type('minutes again');
  await expect(visual.locator('h1')).toHaveText('Typst in five minutes again');

  wasm.release();
  // pictures come to boxes near the view; the equation is further down the page
  await equation.scrollIntoViewIfNeeded();
  await expect(equation.locator('img.zwf-visual__rendering')).toBeVisible();
  await expect(equation.locator('.zwf-visual__code')).toBeHidden();
});

test('the preview says when it loads fonts', async ({ page }) => {
  const fonts = await holdBack(page, /\.(otf|ttf)$/);
  await page.goto('/');
  await expect(loader(page).getByRole('status')).toHaveText('Loading fonts…');
  fonts.release();
  await expect(preview(page).locator('.zwf-preview__page svg').first()).toBeVisible();
});

test('the preview names a package while it downloads', async ({ page }) => {
  const archive = join(PACKAGES, 'merman-0.4.0.tar.gz');
  const merman = await holdBack(page, 'https://packages.typst.org/**', (route) =>
    existsSync(archive) && route.request().url().endsWith('/merman-0.4.0.tar.gz') ? route.fulfill({ path: archive }) : route.fallback(),
  );
  await page.goto('/?example=advanced');
  await expect(loader(page).getByRole('status')).toHaveText('Downloading @preview/merman 0.4.0…', { timeout: 30_000 });
  merman.release();
  await expect(page.getByTestId('zwf-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await expect(preview(page).locator('.zwf-preview__page').first()).toBeVisible();
});
