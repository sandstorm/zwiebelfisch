// BundleAssets: a page's images, style sheets and fonts served from memory. See previewHtml in ../preview-html.ts.
import { resolvePath } from '../model/bundle';

/**
 * Blob URLs for the files a page loads, and pages whose relative URLs point to them. A file keeps its URL while its
 * data stays the same, so an unchanged style sheet or image is not loaded again after an edit. A style sheet's own
 * `url(…)`s (fonts, images) are rewritten the same way, relative to it.
 */
export class BundleAssets {
  private readonly urls = new Map<string, { version: unknown; url: string }>();

  /**
   * `read(path)`: the file at a bundle path, null if there is none; its `version` is the same (`===`) while its data
   * stays the same (a hash, or the data itself while it is never changed in place).
   */
  constructor(private readonly read: (path: string) => { data: Uint8Array; version: unknown } | null) {}

  /** Rewrites the URLs of what page `path` (parsed as `doc`) loads to blob URLs; links (`<a href>`) stay as they are. */
  rewritePage(doc: Document, path: string): void {
    for (const element of doc.querySelectorAll('[src], link[href], [poster]')) {
      for (const name of URL_ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (value === null || (name === 'href' && element.localName !== 'link')) continue;
        const url = this.url(resolvePath(path, value));
        if (url) element.setAttribute(name, url);
      }
    }
    for (const style of doc.querySelectorAll('style')) style.textContent = this.rewriteCss(style.textContent ?? '', path);
    for (const element of doc.querySelectorAll<HTMLElement>('[style]')) element.setAttribute('style', this.rewriteCss(element.getAttribute('style')!, path));
  }

  /** Revokes every URL made. */
  dispose(): void {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  /** The blob URL of bundle path `path`; null if there is no such file. */
  private url(path: string | null): string | null {
    const file = path === null ? null : this.read(path);
    if (path === null || file === null) return null;
    const known = this.urls.get(path);
    if (known && known.version === file.version) return known.url;
    if (known) URL.revokeObjectURL(known.url);
    const type = typeOf(path);
    const body = type === 'text/css' ? this.rewriteCss(new TextDecoder().decode(file.data), path) : file.data;
    const url = URL.createObjectURL(new Blob([body as BlobPart], { type }));
    this.urls.set(path, { version: file.version, url });
    return url;
  }

  /** CSS of file `path` with its `url(…)`s of bundle files as blob URLs. */
  private rewriteCss(css: string, path: string): string {
    return css.replace(CSS_URL, (whole, _quote: string, reference: string) => {
      const url = this.url(resolvePath(path, reference));
      return url ? `url("${url}")` : whole;
    });
  }
}

const URL_ATTRIBUTES = ['src', 'href', 'poster'] as const;

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** The media type a browser needs to use a file (a style sheet's, an SVG's); the others work as bytes too. */
function typeOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return TYPES[extension] ?? '';
}

const TYPES: Record<string, string> = {
  css: 'text/css',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  html: 'text/html',
};
