// Tests for the `local/no-re-exports` rule: forwarding another file's names fails, exporting one's own passes.
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import noReExports from './no-re-exports.js';

/** The rule's messages for `code` in `filename`. */
function lint(code, filename = 'src/x/x.ts') {
  const linter = new Linter({ configType: 'flat' });
  const config = [
    {
      files: ['**/*.ts'],
      languageOptions: { parser: tseslint.parser },
      plugins: { local: { rules: { 'no-re-exports': noReExports } } },
      rules: { 'local/no-re-exports': 'error' },
    },
  ];
  return linter.verify(code, config, { filename }).map((m) => m.message);
}

describe('no-re-exports', () => {
  it('fails on export … from, also of types, and on export *', () => {
    expect(lint("export { a, b as c } from './a';")).toHaveLength(2);
    expect(lint("export type { A } from './a';")).toEqual([expect.stringContaining("'A' is re-exported")]);
    expect(lint("export * from './a';")).toHaveLength(1);
    expect(lint("export * as a from './a';")).toHaveLength(1);
  });

  it('fails on exporting an imported name, also as default', () => {
    expect(lint("import { a } from './a';\nexport { a };")).toEqual([expect.stringContaining("'a' is re-exported")]);
    expect(lint("import type { A } from './a';\nexport type { A };")).toHaveLength(1);
    expect(lint("import a from './a';\nexport default a;")).toHaveLength(1);
  });

  it("allows a host's contract to forward its implementation, and the host's entry a subfolder's contract", () => {
    expect(lint("export { a, type A } from './h-impl';", 'src/hosts/h/h.ts')).toEqual([]);
    expect(lint("export { a, type A } from './sub/sub';", 'src/hosts/h/h.ts')).toEqual([]);
    expect(lint("export { a } from './sub-impl';", 'src/hosts/h/sub/sub.ts')).toEqual([]);
    expect(lint("export { a } from './other/sub';", 'src/hosts/h/sub/sub.ts')).toHaveLength(1);
    expect(lint("export { a } from './sub/other';", 'src/hosts/h/h.ts')).toHaveLength(1);
    expect(lint("export type { A } from './h-impl';", 'src/hosts/h/h.ts')).toHaveLength(1);
    expect(lint("export { a } from './x-impl';", 'src/core/x/x.ts')).toHaveLength(1);
  });

  it("allows exporting the file's own declarations, also through an export list", () => {
    expect(lint("import { a } from './a';\nexport const b = a + 1;\nexport function f() {}\nexport interface I {}")).toEqual([]);
    expect(lint('const b = 1;\ntype T = string;\nexport { b, type T };')).toEqual([]);
    expect(lint('export default function f() {}')).toEqual([]);
  });
});
