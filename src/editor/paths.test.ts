import { describe, expect, it } from 'vitest';
import { displayName, fileKind, referencePath, toPath } from './paths';

describe('fileKind', () => {
  it('tells Typst sources, images and other files apart', () => {
    expect(fileKind('/main.typ')).toBe('typst');
    expect(fileKind('/img/Logo.PNG')).toBe('image');
    expect(fileKind('/logo.svg')).toBe('image');
    expect(fileKind('/data.csv')).toBe('data');
    expect(fileKind('/README')).toBe('data');
  });
});

describe('toPath', () => {
  it('turns a typed name into a project path, adding the default extension', () => {
    expect(toPath('chapter 2', '.typ')).toEqual({ path: '/chapter 2.typ' });
    expect(toPath('  /parts/intro.typ ', '.typ')).toEqual({ path: '/parts/intro.typ' });
    expect(toPath('./notes.typ', '.typ')).toEqual({ path: '/notes.typ' });
    expect(toPath('logo', '.png')).toEqual({ path: '/logo.png' });
  });

  it('keeps an explicit extension', () => {
    expect(toPath('table.csv', '.typ')).toEqual({ path: '/table.csv' });
  });

  it('rejects empty names, parent references and deep folders', () => {
    expect(toPath('  ', '.typ')).toEqual({ error: 'Please enter a name.' });
    expect(toPath('../secret.typ', '.typ')).toHaveProperty('error');
    expect(toPath('a/b/c.typ', '.typ')).toHaveProperty('error');
    expect(toPath('folder/', '.typ')).toHaveProperty('error');
    expect(toPath('a\\b.typ', '.typ')).toHaveProperty('error');
  });
});

describe('referencePath', () => {
  it('is relative within the same folder and absolute otherwise', () => {
    expect(referencePath('/main.typ', '/logo.png')).toBe('logo.png');
    expect(referencePath('/parts/a.typ', '/parts/b.png')).toBe('b.png');
    expect(referencePath('/parts/a.typ', '/logo.png')).toBe('/logo.png');
    expect(referencePath('/main.typ', '/img/logo.png')).toBe('img/logo.png');
  });
});

describe('displayName', () => {
  it('drops the leading slash', () => {
    expect(displayName('/parts/intro.typ')).toBe('parts/intro.typ');
  });
});
