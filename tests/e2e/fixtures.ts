import { test as base, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '../../dist/demo');

/** Serves the built demo app from dist/demo for every request to the baseURL host. */
export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    await page.route(`${baseURL}/**`, (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = join(DIST, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
      return existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
    });
    await use(page);
  },
});

export { expect };
