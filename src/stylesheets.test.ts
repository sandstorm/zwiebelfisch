// Tests for every stylesheet under src/: each one parses without errors and has no nested style rules. A rule
// left unclosed is still valid CSS (it closes at the end of the file) and silently nests everything after it.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { transform } from 'lightningcss';
import { describe, expect, it } from 'vitest';

const SRC = new URL('.', import.meta.url).pathname;

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

/** The selectors of style rules inside other style rules (we write plain, unnested CSS). */
function nestedRules(path: string): string[] {
  const nested: string[] = [];
  transform({
    filename: path,
    code: readFileSync(path),
    errorRecovery: false,
    visitor: {
      Rule: {
        style(rule) {
          for (const inner of rule.value.rules ?? []) {
            if (inner.type === 'style') nested.push(JSON.stringify(inner.value.selectors));
          }
        },
      },
    },
  });
  return nested;
}

/**
 * Hex colors outside the color tokens (`--te-*: light-dark(..)`), which would stay light in dark mode. Allowed:
 * the fallback of a collaborator's color (`var(--typst-remote-*, #..)`), and ProseMirror's own stylesheet.
 */
function untokenizedColors(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*--te-[\w-]+:/.test(line))
    .map((line) => line.replace(/var\(--typst-remote-[\w-]+, #[0-9a-f]+\)/gi, ''))
    .flatMap((line) => line.match(/#[0-9a-f]{3,8}\b/gi) ?? []);
}

/** `{` minus `}` outside comments and strings: 0 when every block is closed. */
function openBlocks(css: string): number {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return [...code].reduce((depth, c) => depth + (c === '{' ? 1 : c === '}' ? -1 : 0), 0);
}

describe('stylesheets', () => {
  const files = stylesheets(SRC);

  it('finds the stylesheets', () => {
    expect(files.map((path) => relative(SRC, path))).toContain('typst-editor/typst-editor.css');
  });

  for (const path of files) {
    describe(relative(SRC, path), () => {
      it('parses without errors and nests no style rules', () => {
        expect(nestedRules(path)).toEqual([]);
      });

      it('closes every block', () => {
        expect(openBlocks(readFileSync(path, 'utf8'))).toBe(0);
      });

      if (!path.endsWith('visual-view.css')) {
        it('takes its colors from the tokens (light and dark)', () => {
          expect(untokenizedColors(readFileSync(path, 'utf8'))).toEqual([]);
        });
      }
    });
  }
});
