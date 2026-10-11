// FilenamePattern: the glob a custom editor is registered for (VS Code's `filenamePattern`), matched against a
// project path, and how specific it is (which editor opens a file when several match). See custom-editors.ts.
import { ProjectPath } from '../../../core/paths/paths';

/**
 * A glob over file names: `*` any characters but `/`, `**` any characters, `?` one character but `/`, `{a,b}` one
 * of the alternatives (not nested). Without a `/` it matches the file's name (`*.drawio.png`), with one the path
 * from the project root without the leading slash (`diagrams/*.png`). Case-insensitive: `Logo.PNG` is an image.
 */
export class FilenamePattern {
  readonly #regex: RegExp;
  readonly #byPath: boolean;
  /** The characters a matching name must have literally (a brace group counts its shortest alternative). */
  readonly specificity: number;

  constructor(glob: string) {
    this.#byPath = glob.includes('/');
    this.#regex = new RegExp(`^${toRegexSource(glob)}$`, 'i');
    this.specificity = literalLength(glob);
  }

  matches(path: ProjectPath): boolean {
    const name = this.#byPath ? ProjectPath.displayName(path) : ProjectPath.name(path);
    return this.#regex.test(name);
  }
}

const SPECIAL = /[.+^$()|[\]\\]/g;

function toRegexSource(glob: string): string {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*';
      i++;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) throw new Error(`Unclosed { in the file name pattern ${glob}`);
      source += `(?:${glob.slice(i + 1, end).split(',').map(toRegexSource).join('|')})`;
      i = end;
    } else source += char.replace(SPECIAL, '\\$&');
  }
  return source;
}

function literalLength(glob: string): number {
  const groups = [...glob.matchAll(/\{([^}]*)\}/g)].map((group) => Math.min(...group[1].split(',').map(literalLength)));
  const outside = glob.replace(/\{[^}]*\}/g, '').replace(/[*?]/g, '');
  return outside.length + groups.reduce((sum, length) => sum + length, 0);
}
