// What the docs-files plugin (plugin.ts, node; dev server and `vite preview`) and the demo page (docs-sync.ts) agree on:
// the endpoint, the session token's meta tag and header, the event stream of what is on disk, and how a file travels
// in it. See docs/30_architecture/11_development.typ ("Writing the docs in the demo").

/**
 * The endpoint: `PUT ?path=` writes the body, `DELETE ?path=` deletes, `POST ?path=&to=` renames; `GET ?token=` is the
 * event stream (Server-Sent Events: `DOCS_FILES_SNAPSHOT` once per connection, then `DOCS_FILES_CHANGE`s).
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
 * A file in docs/ that changed on disk, by its path relative to docs/ (`10_guide/02_features.typ`): its content as text
 * (text files, see `isTextPath`) or base64 (the rest), or deleted.
 */
export type DiskChange = { path: string } & ({ text: string } | { base64: string } | { deleted: true });

const TEXT_EXTENSIONS = new Set(['typ', 'mmd', 'svg', 'md', 'txt', 'csv', 'json', 'yaml', 'yml', 'toml', 'bib', 'css', 'html', 'xml']);

/** Whether the file at `path` travels as text: by its extension. */
export function isTextPath(path: string): boolean {
  return TEXT_EXTENSIONS.has(path.slice(path.lastIndexOf('.') + 1).toLowerCase());
}
