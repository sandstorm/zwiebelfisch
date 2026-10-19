// See WindowApi in ../window.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { InputBoxOptions, SaveDialogOptions } from '../window';

/**
 * Asks for the path of a new file with `ask` (an input box), as `options` say, refusing paths `exists` has. Resolves
 * to the path, or undefined when cancelled. VS Code's `window.showSaveDialog`, without a file system dialog.
 *
 * @internal Extensions use it through `window.showSaveDialog`.
 */
export async function showSaveDialog(
  ask: (options: InputBoxOptions) => Promise<string | undefined>,
  exists: (path: ProjectPath) => boolean,
  options: SaveDialogOptions = {},
): Promise<ProjectPath | undefined> {
  const endings = Object.values(options.filters ?? {}).flat();
  const anyEnding = endings.length === 0 || endings.includes('*');
  const extension = endings.find((ending) => ending !== '*');
  const pathOf = (typed: string) => ProjectPath.fromName(completed(typed, extension), extension ? `.${extension}` : '');
  const problemWith = (typed: string): string | null => {
    const target = pathOf(typed);
    if (target.kind === 'invalid') return target.error;
    if (!anyEnding && !endings.some((ending) => target.path.toLowerCase().endsWith(`.${ending.toLowerCase()}`))) {
      return `The name ends in ${endings.map((ending) => `.${ending}`).join(' or ')}.`;
    }
    return exists(target.path) ? `${ProjectPath.displayName(target.path)} already exists.` : null;
  };
  const { value, selection } = startWith(options.defaultUri, exists, anyEnding ? [] : endings);
  const typed = await ask({
    title: options.title ?? 'Save',
    prompt: 'File name',
    value,
    valueSelection: selection,
    validateInput: problemWith,
  });
  if (typed === undefined || problemWith(typed) !== null) return undefined;
  const target = pathOf(typed);
  return target.kind === 'valid' ? target.path : undefined;
}

/** `typed` with the rest of a compound `extension` added when it ends in its start ("flow.drawio" → "flow.drawio.png"). */
function completed(typed: string, extension: string | undefined): string {
  const name = typed.trimEnd();
  const parts = extension?.split('.') ?? [];
  for (let start = parts.length - 1; start > 0; start--) {
    if (name.toLowerCase().endsWith(`.${parts.slice(0, start).join('.')}`.toLowerCase())) return `${name}.${parts.slice(start).join('.')}`;
  }
  return typed;
}

/**
 * What the input starts with: a new file's name proposed by `defaultUri` (one the project does not have, ending in
 * one of `endings`), the part before the ending selected; else the folder of `defaultUri` (a file's folder, or the
 * folder itself) and a `/`, the caret after it ('' at the top).
 */
function startWith(defaultUri: ProjectPath | undefined, exists: (path: ProjectPath) => boolean, endings: readonly string[]): { value: string; selection: [number, number] } {
  if (defaultUri === undefined) return { value: '', selection: [0, 0] };
  const ending = exists(defaultUri) ? undefined : endings.find((candidate) => defaultUri.toLowerCase().endsWith(`.${candidate.toLowerCase()}`));
  if (ending !== undefined) {
    const value = defaultUri.slice(1);
    return { value, selection: [value.lastIndexOf('/') + 1, value.length - ending.length - 1] };
  }
  const folder = exists(defaultUri) ? defaultUri.slice(0, defaultUri.lastIndexOf('/')) : defaultUri;
  const value = folder === '' ? '' : `${folder.slice(1)}/`;
  return { value, selection: [value.length, value.length] };
}
