// Tests for paths.ts.
import { describe, expect, it } from 'vitest';
import { PathReference, ProjectPath } from './paths';

const path = ProjectPath.of;
const ref = PathReference.of;

describe('ProjectPath.isTypst', () => {
  it('tells Typst sources from every other file', () => {
    expect(ProjectPath.isTypst(path('/main.typ'))).toBe(true);
    expect(ProjectPath.isTypst(path('/chapters/intro.typ'))).toBe(true);
    expect(ProjectPath.isTypst(path('/img/Logo.PNG'))).toBe(false);
    expect(ProjectPath.isTypst(path('/budget.ic'))).toBe(false);
    expect(ProjectPath.isTypst(path('/typ'))).toBe(false);
  });
});

describe('ProjectPath.fromName', () => {
  it('turns a typed name into a project path, adding the default extension', () => {
    expect(ProjectPath.fromName('chapter 2', '.typ')).toEqual({ kind: 'valid', path: '/chapter 2.typ' });
    expect(ProjectPath.fromName('  /parts/intro.typ ', '.typ')).toEqual({ kind: 'valid', path: '/parts/intro.typ' });
    expect(ProjectPath.fromName('./notes.typ', '.typ')).toEqual({ kind: 'valid', path: '/notes.typ' });
    expect(ProjectPath.fromName('logo', '.png')).toEqual({ kind: 'valid', path: '/logo.png' });
    expect(ProjectPath.fromName('a/b/c', '.typ')).toEqual({ kind: 'valid', path: '/a/b/c.typ' });
  });

  it('keeps an explicit extension', () => {
    expect(ProjectPath.fromName('table.csv', '.typ')).toEqual({ kind: 'valid', path: '/table.csv' });
  });

  it('rejects empty names, parent references and empty folder names', () => {
    expect(ProjectPath.fromName('  ', '.typ')).toEqual({ kind: 'invalid', error: 'Please enter a name.' });
    expect(ProjectPath.fromName('../secret.typ', '.typ')).toHaveProperty('kind', 'invalid');
    expect(ProjectPath.fromName('folder/', '.typ')).toHaveProperty('kind', 'invalid');
    expect(ProjectPath.fromName('a\\b.typ', '.typ')).toHaveProperty('kind', 'invalid');
  });
});

describe('ProjectPath.referenceTo', () => {
  it('is relative within the same folder and absolute otherwise', () => {
    expect(ProjectPath.referenceTo(path('/main.typ'), path('/logo.png'))).toBe('logo.png');
    expect(ProjectPath.referenceTo(path('/parts/a.typ'), path('/parts/b.png'))).toBe('b.png');
    expect(ProjectPath.referenceTo(path('/parts/a.typ'), path('/logo.png'))).toBe('/logo.png');
    expect(ProjectPath.referenceTo(path('/main.typ'), path('/img/logo.png'))).toBe('img/logo.png');
  });
});

describe('ProjectPath.displayName', () => {
  it('drops the leading slash', () => {
    expect(ProjectPath.displayName(path('/parts/intro.typ'))).toBe('parts/intro.typ');
  });
});

describe('ProjectPath.resolve', () => {
  it('resolves Typst paths like Typst: relative to the file, or from the project root', () => {
    expect(ProjectPath.resolve(path('/main.typ'), ref('logo.png'))).toBe('/logo.png');
    expect(ProjectPath.resolve(path('/chapters/one.typ'), ref('img/a.png'))).toBe('/chapters/img/a.png');
    expect(ProjectPath.resolve(path('/chapters/one.typ'), ref('../logo.png'))).toBe('/logo.png');
    expect(ProjectPath.resolve(path('/chapters/one.typ'), ref('./a.png'))).toBe('/chapters/a.png');
    expect(ProjectPath.resolve(path('/chapters/one.typ'), ref('/logo.png'))).toBe('/logo.png');
  });

  it('is null for paths outside the project', () => {
    expect(ProjectPath.resolve(path('/main.typ'), ref('../x.png'))).toBeNull();
    expect(ProjectPath.resolve(path('/main.typ'), ref(''))).toBeNull();
  });
});

describe('ProjectPath.parse', () => {
  it('takes absolute paths with real segments only', () => {
    expect(ProjectPath.parse('/chapters/intro.typ')).toBe('/chapters/intro.typ');
    for (const invalid of ['main.typ', '/', '//a.typ', '/a/../b.typ', '/./a.typ', '/a\\b.typ', '/folder/']) {
      expect(ProjectPath.parse(invalid)).toBeNull();
    }
  });

  it('of() throws for what parse() refuses', () => {
    expect(() => ProjectPath.of('main.typ')).toThrow('Not a project path: main.typ');
  });
});
