// Playwright fixtures: the static demo build served through request interception (no dev server, no port).
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
 * click needs to land in the glyph's box, not on its ink. The box is computed
 * from the glyph's outline (the `<path>` in the `<symbol>` it uses), because
 * Firefox's box of a `<use>` of a `<symbol>` is the symbol's whole viewport (as
 * wide as the page, from the glyph on), whose middle is usually blank paper.
 * A plain `click()` would also insist that the element hit is the glyph itself,
 * which fails whenever the middle of the box is blank: always for a "C".
 */
export async function clickGlyph(glyph: Locator, options: { clickCount?: number } = {}): Promise<void> {
  await expect(glyph).toBeVisible();
  const point = await glyph.evaluate((use: SVGUseElement) => {
    const id = (use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '').slice(1);
    const outline = (use.getRootNode() as Document | ShadowRoot).getElementById(id)?.querySelector('path');
    if (!outline) throw new Error(`glyph ${id} has no outline`);
    // a rendered copy of the outline where the glyph is drawn: same place, honest box
    const copy = outline.cloneNode() as SVGPathElement;
    copy.setAttribute('transform', `translate(${use.x.baseVal.value} ${use.y.baseVal.value})`);
    copy.setAttribute('fill', 'none');
    use.after(copy);
    copy.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const box = copy.getBoundingClientRect();
    copy.remove();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await glyph.page().mouse.click(point.x, point.y, options);
}

/** The file panel's tree row of `path` (as shown: `chapters/intro.typ`, a folder `chapters`). */
export function fileRow(scope: Page | Locator, path: string): Locator {
  return scope.getByTestId('typst-files').locator(`[role=treeitem][title="${path}"]`);
}

/** Opens `path` in the file panel: expands the folders around it, then clicks its row. */
export async function openFile(scope: Page | Locator, path: string): Promise<void> {
  const parts = path.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const folder = fileRow(scope, parts.slice(0, depth).join('/'));
    if ((await folder.getAttribute('aria-expanded')) === 'false') await folder.click();
  }
  await fileRow(scope, path).click();
}
