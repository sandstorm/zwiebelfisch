// End-to-end tests (Playwright, against the demo build): the widget over a slow connection — the text first, editable,
// then what the preview still loads (in its pane only, not in the status bar), then the pages
// (docs/30_architecture/07_workbench.typ, "Loading"). Requests are held back until the test lets them through.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page, type Route } from '@playwright/test';
import { test } from './fixtures';

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

const preview = (page: Page) => page.getByTestId('typst-preview');
const loader = (page: Page) => page.getByTestId('typst-preview-loader');
/** What the preview loads shows in its pane only: the status bar has no progress entry for it. */
const statusBarProgress = (page: Page) => page.getByTestId('typst-progress');

test('the text shows and takes typing before the compiler is there; the preview says it loads it, then shows the pages', async ({ page }) => {
  const wasm = await holdBack(page, /\.wasm$/);
  await page.goto('/');
  await expect(page.getByTestId('typst-visual').locator('h1')).toHaveText('Typst in five minutes');
  await expect(loader(page).getByRole('status')).toHaveText('Loading the Typst compiler…');
  await expect(loader(page).getByRole('progressbar')).toBeVisible();
  await expect(statusBarProgress(page)).toHaveCount(0);

  await page.getByRole('tab', { name: 'Source' }).click();
  await page.getByTestId('typst-source').locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('\n\nTyped while the compiler loads');
  await expect(page.getByTestId('typst-source')).toContainText('Typed while the compiler loads');
  await expect(preview(page).locator('.typst-preview__page')).toHaveCount(0);
  expect(wasm.held).toHaveLength(1);

  wasm.release();
  await expect(preview(page).locator('.typst-preview__page svg').first()).toBeVisible();
  await expect(loader(page)).toBeHidden();
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/);
});

test('the Visual editor takes typing while the compiler loads; raw boxes show their code until their pictures come', async ({ page }) => {
  const wasm = await holdBack(page, /\.wasm$/);
  await page.goto('/');
  const visual = page.getByTestId('typst-visual');
  // the equation is a raw box: its code first
  const equation = visual.locator('.typst-visual__raw-block', { hasText: 'integral_0^1' });
  await expect(equation.locator('.typst-visual__code')).toContainText('integral_0^1');
  await expect(equation.locator('img.typst-visual__rendering')).toBeHidden();
  await visual.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' again');
  await expect(visual.locator('h1')).toHaveText('Typst in five minutes again');

  wasm.release();
  await expect(equation.locator('img.typst-visual__rendering')).toBeVisible();
  await expect(equation.locator('.typst-visual__code')).toBeHidden();
});

test('the preview says when it loads fonts', async ({ page }) => {
  const fonts = await holdBack(page, /\.(otf|ttf)$/);
  await page.goto('/');
  await expect(loader(page).getByRole('status')).toHaveText('Loading fonts…');
  await expect(statusBarProgress(page)).toHaveCount(0);
  fonts.release();
  await expect(preview(page).locator('.typst-preview__page svg').first()).toBeVisible();
});

test('the preview names a package while it downloads', async ({ page }) => {
  const archive = join(PACKAGES, 'merman-0.4.0.tar.gz');
  const merman = await holdBack(page, 'https://packages.typst.org/**', (route) =>
    existsSync(archive) && route.request().url().endsWith('/merman-0.4.0.tar.gz') ? route.fulfill({ path: archive }) : route.fallback(),
  );
  await page.goto('/?example=advanced');
  await expect(loader(page).getByRole('status')).toHaveText('Downloading @preview/merman 0.4.0…', { timeout: 30_000 });
  await expect(statusBarProgress(page)).toHaveCount(0);
  merman.release();
  await expect(page.getByTestId('typst-status')).toHaveText(/✓ compiled/, { timeout: 30_000 });
  await expect(preview(page).locator('.typst-preview__page').first()).toBeVisible();
});
