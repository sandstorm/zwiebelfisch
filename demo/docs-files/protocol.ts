// What the docs-files plugin (node) and the demo page agree on: the endpoint, the session token's meta tag and
// header, the event stream of what is on disk, and how a file travels in it. See docsFiles in plugin.ts.

/**
 * The endpoint: `PUT ?path=` writes the body, `DELETE ?path=` deletes, `POST ?path=&to=` renames; `GET ?token=` is the
 * event stream (Server-Sent Events: `DOCS_FILES_SNAPSHOT` once per connection, then `DOCS_FILES_CHANGE`s).
 *
 * A `PUT` names the version it replaces: `If-Match: "<contentTag>"` of the content the page last read or wrote there,
 * or `If-None-Match: *` for a file it believes absent. When the file on disk is another, nothing is written (412).
 */
export const DOCS_FILES_ENDPOINT = '/__docs-files';

/** The `<meta name=… content=token>` the plugin puts into the served page; a static build has none. */
export const DOCS_FILES_META = 'docs-files-token';

/** The request header that carries the token. */
export const DOCS_FILES_HEADER = 'x-docs-files-token';

/** The query parameter that carries the token to the event stream (an `EventSource` sends no headers of its own). */
export const DOCS_FILES_TOKEN_PARAM = 'token';

/** The stream's first event on each connection: every file in docs/ as it is now (`DiskChange[]`, none deleted). */
export const DOCS_FILES_SNAPSHOT = 'snapshot';

/** The stream's event for a file in docs/ that changed on disk, not by the page's own write (`DiskChange`). */
export const DOCS_FILES_CHANGE = 'change';

/**
 * A file in docs/ that changed on disk, by its path relative to docs/ (`20_features/02_visual-editor.typ`): its content as text
 * (text files, see `isTextPath`) or base64 (the rest), or deleted.
 */
export type DiskChange = { path: string } & ({ text: string } | { base64: string } | { deleted: true });

/** Whether the file at `path` travels as text: by its extension. */
export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
}

/**
 * A file's version as `If-Match` names it: a 53-bit hash of its bytes (cyrb53), with the length, in hex. It tells
 * versions apart, nothing more. Synchronous, so a write when the page goes away still starts before it is gone.
 */
export function contentTag(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const byte of bytes) {
    h1 = Math.imul(h1 ^ byte, 2654435761);
    h2 = Math.imul(h2 ^ byte, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${bytes.length.toString(16)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

const TEXT_EXTENSIONS =new Set(['typ', 'mmd', 'svg', 'md', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'bib', 'css', 'html', 'xml']);
