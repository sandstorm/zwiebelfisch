// Tests for style-index.ts (StyleIndex) and new-style.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../../core/project/project';
import { scanStyles } from './discover';
import { newStyle } from './new-style';
import { StyleIndex } from './style-index';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const STYLES = '/// @style paragraph Note\n#let note(body) = block(body)\n';

function setup(files: Record<string, string> = {}) {
  const project = new Project(path('/main.typ'), { '/main.typ': '= Doc\n', '/styles.typ': STYLES, ...files });
  const index = new StyleIndex(project);
  return { project, index };
}

describe('StyleIndex', () => {
  it('lists the project styles and tells listeners when the list changes, not on every edit', () => {
    const { project, index } = setup();
    expect(index.styles()).toEqual([{ name: 'note', kind: 'paragraph', label: 'Note', path: path('/styles.typ') }]);
    const listener = vi.fn();
    index.onDidChange(listener);
    project.document(path('/main.typ'))!.setText('= Doc\n\nText\n', 'test');
    expect(listener).not.toHaveBeenCalled();
    project.document(path('/styles.typ'))!.setText(`${STYLES}/// @style text Key\n#let key(body) = strong(body)\n`, 'test');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.styles().map((s) => s.name)).toEqual(['note', 'key']);
    project.apply({ kind: 'delete', path: path('/styles.typ') });
    expect(index.styles()).toEqual([]);
  });

  it("imports a style into a document relative to its path, once; not into the style's own file", () => {
    const { project, index } = setup({ '/chapters/one.typ': 'Text\n' });
    const [note] = index.styles();
    const chapter = project.document(path('/chapters/one.typ'))!;
    expect(index.calculateImportChange(chapter, note, 0)).toEqual({ from: 0, to: 0, insert: '#import "/styles.typ": note\n\n' });
    const main = project.document(path('/main.typ'))!;
    expect(index.calculateImportChange(main, note, 0)).toEqual({ from: 0, to: 0, insert: '#import "styles.typ": note\n\n' });
    main.setText('\n= Doc\n', 'test');
    expect(index.calculateImportChange(main, note, 0)).toEqual({ from: 0, to: 0, insert: '#import "styles.typ": note\n' });
    main.setText('#import "styles.typ": note\n#note[x]\n', 'test');
    expect(index.calculateImportChange(main, note, 30)).toBeNull();
    const own = project.document(path('/styles.typ'))!;
    expect(index.calculateImportChange(own, note, STYLES.length)).toBeNull();
  });
});

describe('StyleIndex.homeFile (where New style… adds one)', () => {
  it('is the file declaring the most styles, else /styles.typ', () => {
    const helpers = '/// @style paragraph A\n#let a(body) = body\n/// @style text B\n#let b(body) = body\n';
    const { index } = setup({ '/helpers.typ': helpers });
    expect(index.homeFile()).toBe(path('/helpers.typ'));
    const none = new StyleIndex(new Project(path('/main.typ'), { '/main.typ': '' }));
    expect(none.homeFile()).toBe(path('/styles.typ'));
  });
});

describe('newStyle', () => {
  it('appends a declared paragraph style with a free name, and says where it is', () => {
    const first = newStyle('');
    expect(scanStyles(first.text)).toEqual([{ name: 'new-style', kind: 'paragraph', label: 'New style' }]);
    expect(first.text.slice(first.from, first.to)).toMatch(/^\/\/\/ @style paragraph New style\n#let new-style\(body\) = /);
    const second = newStyle(first.text);
    expect(scanStyles(second.text).map((s) => [s.name, s.label])).toEqual([['new-style', 'New style'], ['new-style-2', 'New style 2']]);
    expect(second.text.startsWith(`${first.text}\n`)).toBe(true);
  });

  it('names the function after the label the user gave', () => {
    const added = newStyle('#let note(body) = body\n', 'Note');
    expect(scanStyles(added.text)).toEqual([{ name: 'note-2', kind: 'paragraph', label: 'Note 2' }]);
    expect(scanStyles(newStyle('', ' Side box! ').text)).toEqual([{ name: 'side-box', kind: 'paragraph', label: 'Side box!' }]);
    expect(scanStyles(newStyle('', '2 columns').text).map((style) => style.name)).toEqual(['style-2-columns']);
  });
});
