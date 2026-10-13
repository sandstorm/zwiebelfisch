// Paths and links in an HTML bundle, and which page follows the cursor. See previewHtml in ../preview-html.ts.
import type { ElementLocation } from '../../../core/typst-engine/typst-engine';

/** Where a link on a bundle page leads. */
export type LinkTarget =
  /** A document of the bundle (the page itself for `#…`), scrolled to the element with id `fragment`. */
  | { kind: 'page'; path: string; fragment: string | null }
  /** Another file of the bundle: an asset, a paged document's PDF. */
  | { kind: 'file'; path: string }
  /** A URL outside the bundle (`https:`, `mailto:`). */
  | { kind: 'external'; url: string }
  /** Nowhere: a relative path the bundle has no file for, `javascript:`. */
  | { kind: 'none' };

/**
 * Where link `href` on bundle page `from` leads, among the bundle's `files` (path → whether it is a document). A path
 * ending in `/` means its `index.html`.
 */
export function linkTarget(from: string, href: string, files: ReadonlyMap<string, boolean>): LinkTarget {
  if (href.startsWith('#')) return { kind: 'page', path: from, fragment: fragmentOf(href) };
  if (SCHEME.test(href) || href.startsWith('//')) return /^javascript:/i.test(href) ? { kind: 'none' } : { kind: 'external', url: href };
  const resolved = resolvePath(from, href);
  if (resolved === null) return { kind: 'none' };
  const path = resolved === '' || resolved.endsWith('/') ? `${resolved}index.html` : resolved;
  const document = files.get(path);
  if (document === undefined) return { kind: 'none' };
  return document ? { kind: 'page', path, fragment: fragmentOf(href) } : { kind: 'file', path };
}

/**
 * The bundle path `reference` names, relative to the file `from` (`/…`: to the bundle's root), without query and
 * fragment, percent-decoded; null for a URL or a path above the root.
 */
export function resolvePath(from: string, reference: string): string | null {
  if (SCHEME.test(reference) || reference.startsWith('//')) return null;
  const path = reference.replace(/[?#].*$/s, '');
  const segments = path.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const segment of path.split('/').slice(path.startsWith('/') ? 1 : 0)) {
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
    } else if (segment !== '.') segments.push(segment);
  }
  try {
    return decodeURIComponent(segments.join('/'));
  } catch {
    return null;
  }
}

/**
 * Which element to show for the cursor, of those its text produced (the first of each document): the one on the page
 * shown if there is one (text every page has, a template's), else the first; null: none (the page stays).
 */
export function pageForCursor(shown: string | null, elements: readonly ElementLocation[]): ElementLocation | null {
  return elements.find((element) => element.path === shown) ?? elements[0] ?? null;
}

/** A URL's scheme (`https:`, `mailto:`), as opposed to a relative path. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function fragmentOf(href: string): string | null {
  const index = href.indexOf('#');
  if (index < 0 || index === href.length - 1) return null;
  try {
    return decodeURIComponent(href.slice(index + 1));
  } catch {
    return href.slice(index + 1);
  }
}
