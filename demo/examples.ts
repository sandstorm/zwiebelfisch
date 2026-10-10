import type { ProjectFiles } from '../src';

/**
 * The demo's example projects. Each one is a folder under `examples/` whose
 * files become the project's files: `examples/<name>/main.typ` → `/main.typ`,
 * `examples/<name>/chapters/a.typ` → `/chapters/a.typ`. Typst files are text,
 * everything else (images) is passed as bytes.
 */
export const EXAMPLES = [
  { name: 'hello', label: 'Hello' },
  { name: 'simple', label: 'Simple' },
  { name: 'advanced', label: 'Advanced' },
] as const;

export type ExampleName = (typeof EXAMPLES)[number]['name'];

/** The example shown without `?example`; the e2e specs rely on its content. */
export const DEFAULT_EXAMPLE: ExampleName = 'hello';

const sources = import.meta.glob<string>('./examples/**/*.{typ,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The files of an example project, keyed by absolute project path. */
export function exampleFiles(name: ExampleName): ProjectFiles {
  const prefix = `./examples/${name}`;
  const files: ProjectFiles = {};
  for (const [key, text] of Object.entries(sources)) {
    if (!key.startsWith(`${prefix}/`)) continue;
    const path = key.slice(prefix.length);
    files[path] = path.endsWith('.typ') ? text : new TextEncoder().encode(text);
  }
  return files;
}

/**
 * The example a URL asks for: `?example=<name>`; the older `?files` (a
 * multi-file project) means `advanced`; anything else the default.
 */
export function exampleFromQuery(params: URLSearchParams): ExampleName {
  const asked = EXAMPLES.find(({ name }) => name === params.get('example'));
  if (asked) return asked.name;
  return params.has('files') ? 'advanced' : DEFAULT_EXAMPLE;
}

/** The query that opens example `name`, keeping the other parameters (`room`, `user`). */
export function exampleQuery(name: ExampleName, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete('files');
  next.set('example', name);
  return `?${next}`;
}
