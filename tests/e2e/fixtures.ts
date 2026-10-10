import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const DEMO = join(ROOT, 'dist/demo');
/** Served from the repository root, so examples can reference ../../dist/lib. */
const FROM_ROOT = ['/examples/', '/dist/lib/'];

/**
 * Serves every request to the baseURL host from disk: the examples and the
 * library build from the repository root, everything else from dist/demo.
 */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await serve(page, baseURL!);
    await use(page);
  },
});

/** Serves the build to `page` (for pages beyond the `page` fixture, e.g. a second user). */
export async function serve(page: Page, baseURL: string): Promise<void> {
  await page.route(`${baseURL}/**`, (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const dir = FROM_ROOT.some((prefix) => pathname.startsWith(prefix)) ? ROOT : DEMO;
    const file = join(dir, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  });
}

/**
 * Clicks the middle of a glyph (a `<use>` in a preview page), as a user clicking
 * that letter does. The preview maps the click position to the source, so the
 * click needs to land in the glyph's box, not on its ink. A plain `click()` also
 * insists that the element hit at that point is the glyph itself, which fails
 * whenever the middle of the box is blank: always for a "C", and for the
 * "H" of the demo heading the middle lies 0.06 pt above the bottom edge of its
 * thin crossbar, which Firefox's hit test misses.
 */
export async function clickGlyph(glyph: Locator): Promise<void> {
  // `force` skips every actionability check, so wait for the visible glyph first
  await expect(glyph).toBeVisible();
  await glyph.click({ force: true });
}

export { expect };
