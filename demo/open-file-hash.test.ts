// @vitest-environment jsdom
// Tests for open-file-hash.ts.
import { describe, expect, it } from 'vitest';
import type { TypstEditor } from '../src';
import { hashForPath, OpenFileHash, pathFromHash } from './open-file-hash';

function fakeEditor(paths: string[]) {
  const editor = {
    activeFile: '/main.typ',
    open(path: string) {
      if (paths.includes(path)) editor.activeFile = path;
    },
  };
  return editor as unknown as TypstEditor & { activeFile: string };
}

describe('open file in the URL fragment', () => {
  it('maps paths and fragments both ways', () => {
    expect(pathFromHash('#/chapters/intro.typ')).toBe('/chapters/intro.typ');
    expect(pathFromHash('#/a%20b.typ')).toBe('/a b.typ');
    expect(pathFromHash('')).toBeNull();
    expect(pathFromHash('#intro')).toBeNull();
    expect(hashForPath('/a b.typ')).toBe('#/a%20b.typ');
  });

  it('opens the file named in the fragment, now or once it exists', () => {
    history.replaceState(null, '', '#/chapter.typ');
    const hash = new OpenFileHash();
    const paths = ['/main.typ'];
    const editor = fakeEditor(paths);
    hash.attach(editor);
    expect(editor.activeFile).toBe('/main.typ');
    paths.push('/chapter.typ');
    hash.filesChanged();
    expect(editor.activeFile).toBe('/chapter.typ');
  });

  it('writes the shown file into the fragment', () => {
    history.replaceState(null, '', '#');
    const hash = new OpenFileHash();
    hash.attach(fakeEditor(['/main.typ']));
    hash.opened('/images/logo.svg');
    expect(location.hash).toBe('#/images/logo.svg');
  });
});
