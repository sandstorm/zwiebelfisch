// The demo's example projects: demo/examples/<name>/ and docs/ as file maps (import.meta.glob).
import type { ProjectFiles } from '../src';

/**
 * The demo's example projects. Each one is a folder whose files become the
 * project's files: `examples/<name>/main.typ` → `/main.typ`,
 * `examples/<name>/chapters/a.typ` → `/chapters/a.typ`. Typst files are text,
 * everything else (images, Mermaid diagrams, spreadsheets) is passed as bytes. "Documentation"
 * is this project's own docs/ (its Typst files, Mermaid diagrams and images): on the dev server and in vite preview
 * its edits are saved there (docs-files/), in a static build nowhere.
 */
export const EXAMPLES = [
  { name: 'hello', label: 'Hello', folder: './examples/hello' },
  { name: 'simple', label: 'Simple', folder: './examples/simple' },
  { name: 'advanced', label: 'Advanced', folder: './examples/advanced' },
  { name: 'docs', label: 'Documentation', folder: '../docs' },
] as const;

export type ExampleName = (typeof EXAMPLES)[number]['name'];

/** The example shown without `?example`; the e2e specs rely on its content. */
export const DEFAULT_EXAMPLE: ExampleName = 'hello';

const sources = import.meta.glob<string>(['./examples/**/*.{typ,svg,mmd}', '../docs/**/*.{typ,svg,mmd}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Binary files (IronCalc spreadsheets, images) as `data:` URLs: `?raw` would decode them as UTF-8. */
const binaries = import.meta.glob<string>(['./examples/**/*.ic', '../docs/**/*.{png,jpg,jpeg,gif,webp}', '!../docs/fonts/**'], {
  query: '?inline',
  import: 'default',
  eager: true,
});

/** The files of an example project, keyed by absolute project path. */
export function exampleFiles(name: ExampleName): ProjectFiles {
  const prefix = EXAMPLES.find((example) => example.name === name)!.folder;
  const files: ProjectFiles = {};
  for (const [key, text] of Object.entries(sources)) {
    if (!key.startsWith(`${prefix}/`)) continue;
    const path = key.slice(prefix.length);
    files[path] = path.endsWith('.typ') ? text : new TextEncoder().encode(text);
  }
  for (const [key, url] of Object.entries(binaries)) {
    if (key.startsWith(`${prefix}/`)) files[key.slice(prefix.length)] = dataUrlBytes(url);
  }
  return files;
}

function dataUrlBytes(url: string): Uint8Array {
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (char) => char.charCodeAt(0));
}

/** The example a URL asks for: `?example=<name>`; anything else the default. */
export function exampleFromQuery(params: URLSearchParams): ExampleName {
  return EXAMPLES.find(({ name }) => name === params.get('example'))?.name ?? DEFAULT_EXAMPLE;
}

/** The query that opens example `name`, keeping the other parameters (`room`, `user`). */
export function exampleQuery(name: ExampleName, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set('example', name);
  return `?${next}`;
}
