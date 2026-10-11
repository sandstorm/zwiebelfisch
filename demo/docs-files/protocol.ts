// What the docs-files dev-server plugin (plugin.ts, node) and the demo page (docs-sync.ts) agree on: the endpoint, the
// session token's meta tag and header, the HMR event for changes on disk, and how a file travels in it. See
// docs/30_architecture/11_development.typ ("Writing the docs in the demo").

/** The endpoint: `PUT ?path=` writes the body, `DELETE ?path=` deletes, `POST ?path=&to=` renames. */
export const DOCS_FILES_ENDPOINT = '/__docs-files';

/** The `<meta name=… content=token>` the plugin puts into the dev server's page; a static build has none. */
export const DOCS_FILES_META = 'docs-files-token';

/** The request header that carries the token. */
export const DOCS_FILES_HEADER = 'x-docs-files-token';

/** The custom HMR event the plugin sends when a file in docs/ changed on disk (not by the page's own write). */
export const DOCS_FILES_EVENT = 'docs-files:change';

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
