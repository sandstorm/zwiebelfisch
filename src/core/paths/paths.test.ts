// Tests for paths.ts.
import { describe, expect, it } from 'vitest';
import { PathReference, ProjectPath } from './paths';

const path = ProjectPath.of;
const ref = PathReference.of;

describe('ProjectPath.kind', () => {
  it('tells Typst sources, images and other files apart', () => {
    expect(ProjectPath.kind(path('/main.typ'))).toBe('typst');
    expect(ProjectPath.kind(path('/img/Logo.PNG'))).toBe('image');
    expect(ProjectPath.kind(path('/logo.svg'))).toBe('image');
    expect(ProjectPath.kind(path('/data.csv'))).toBe('data');
    expect(ProjectPath.kind(path('/sheets/budget.ic'))).toBe('spreadsheet');
    expect(ProjectPath.kind(path('/budget.ic.json'))).toBe('data');
    expect(ProjectPath.kind(path('/README'))).toBe('data');
  });
});

describe('ProjectPath.fromName', () => {
  it('turns a typed name into a project path, adding the default extension', () => {
    expect(ProjectPath.fromName('chapter 2', '.typ')).toEqual({ path: '/chapter 2.typ' });
    expect(ProjectPath.fromName('  /parts/intro.typ ', '.typ')).toEqual({ path: '/parts/intro.typ' });
    expect(ProjectPath.fromName('./notes.typ', '.typ')).toEqual({ path: '/notes.typ' });
    expect(ProjectPath.fromName('logo', '.png')).toEqual({ path: '/logo.png' });
    expect(ProjectPath.fromName('a/b/c', '.typ')).toEqual({ path: '/a/b/c.typ' });
  });

  it('keeps an explicit extension', () => {
    expect(ProjectPath.fromName('table.csv', '.typ')).toEqual({ path: '/table.csv' });
  });

  it('rejects empty names, parent references and empty folder names', () => {
    expect(ProjectPath.fromName('  ', '.typ')).toEqual({ error: 'Please enter a name.' });
    expect(ProjectPath.fromName('../secret.typ', '.typ')).toHaveProperty('error');
    expect(ProjectPath.fromName('folder/', '.typ')).toHaveProperty('error');
    expect(ProjectPath.fromName('a\\b.typ', '.typ')).toHaveProperty('error');
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
