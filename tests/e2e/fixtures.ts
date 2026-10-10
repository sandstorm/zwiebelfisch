import { test as base, expect, type Page } from '@playwright/test';
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

export { expect };
