// The demo's example projects: demo/examples/<name>/ and docs/ as file maps (import.meta.glob). See main.ts.
import type { ProjectFiles } from '../src';

/**
 * The demo's example projects, each a folder whose files become the project's files (`examples/<name>/main.typ` →
 * `/main.typ`): Typst files as text, everything else (images, Mermaid diagrams, spreadsheets) as bytes.
 * "Documentation" is this project's own docs/: on the dev server and in vite preview its edits are saved there, in a
 * static build nowhere. It also has the hosts' contracts its `#api(..)` reads, at their paths from the repository root
 * (`/src/hosts/commands/commands.ts`), as `typst compile --root .` reads them.
 */
export const EXAMPLES = [
  { name: 'simple', label: 'Simple', folder: './examples/simple' },
  { name: 'advanced', label: 'Advanced', folder: './examples/advanced' },
  { name: 'docs', label: 'Documentation', folder: '../docs' },
] as const;

export type ExampleName = (typeof EXAMPLES)[number]['name'];

/** The example shown without `?example`; the e2e specs rely on its content. */
export const DEFAULT_EXAMPLE: ExampleName = 'simple';

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
  if (name === 'docs') for (const [key, text] of Object.entries(contracts)) files[key.slice('..'.length)] = new TextEncoder().encode(text);
  return files;
}

/** Whether `path` is one of the contracts the Documentation example has from the repository (`/src/…`), not a file of docs/. */
export function isContract(path: string): boolean {
  return path.startsWith('/src/');
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

const sources = import.meta.glob<string>(['./examples/**/*.{typ,svg,mmd}', '../docs/**/*.{typ,svg,mmd,css}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Binary files (IronCalc spreadsheets, images such as draw.io diagrams, fonts) as `data:` URLs: `?raw` would decode them as UTF-8. */
const binaries = import.meta.glob<string>(['./examples/**/*.{ic,png}','../docs/**/*.{ic,png,jpg,jpeg,gif,webp,ttf}'], {
  query: '?inline',
  import: 'default',
  eager: true,
});

/** The hosts' entries (`src/hosts/<host>/*.ts`, the typst-conversion and workspace sub-modules; no tests or implementations), for the docs' `#api(..)`. */
const contracts = import.meta.glob<string>(['../src/hosts/*/*.ts', '../src/hosts/visual-editor/typst-conversion/typst-conversion.ts', '../src/hosts/extension-host/workspace/workspace.ts', '!**/*.test.ts', '!**/*-impl.ts', '!**/*-helpers.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

function dataUrlBytes(url: string): Uint8Array {
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (char) => char.charCodeAt(0));
}
