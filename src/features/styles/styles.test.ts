// Tests for styles.ts (StyleIndex) and new-style.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../core/project/project';
import { newStyle, scanStyles, StyleIndex } from './styles';

const STYLES = '/// @style paragraph Note\n#let note(body) = block(body)\n';

function setup(files: Record<string, string> = {}) {
  const project = new Project('/main.typ', { '/main.typ': '= Doc\n', '/styles.typ': STYLES, ...files });
  const index = new StyleIndex(project);
  return { project, index };
}

describe('StyleIndex', () => {
  it('lists the project styles and tells listeners when the list changes, not on every edit', () => {
    const { project, index } = setup();
    expect(index.styles()).toEqual([{ name: 'note', kind: 'paragraph', label: 'Note', path: '/styles.typ' }]);
    const listener = vi.fn();
    index.onChange(listener);
    project.document('/main.typ')!.setText('= Doc\n\nText\n', 'test');
    expect(listener).not.toHaveBeenCalled();
    project.document('/styles.typ')!.setText(`${STYLES}/// @style text Key\n#let key(body) = strong(body)\n`, 'test');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.styles().map((s) => s.name)).toEqual(['note', 'key']);
    project.apply({ kind: 'delete', path: '/styles.typ' });
    expect(index.styles()).toEqual([]);
  });

  it("imports a style into a document relative to its path, once; not into the style's own file", () => {
    const { project, index } = setup({ '/chapters/one.typ': 'Text\n' });
    const [note] = index.styles();
    const chapter = index.forDocument(project.document('/chapters/one.typ')!);
    expect(chapter.importChange('Text\n', note, 0)).toEqual({ from: 0, to: 0, insert: '#import "/styles.typ": note\n\n' });
    const main = index.forDocument(project.document('/main.typ')!);
    expect(main.importChange('= Doc\n', note, 0)).toEqual({ from: 0, to: 0, insert: '#import "styles.typ": note\n\n' });
    expect(main.importChange('\n= Doc\n', note, 0)).toEqual({ from: 0, to: 0, insert: '#import "styles.typ": note\n' });
    expect(main.importChange('#import "styles.typ": note\n#note[x]\n', note, 30)).toBeNull();
    const own = index.forDocument(project.document('/styles.typ')!);
    expect(own.importChange(STYLES, note, STYLES.length)).toBeNull();
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
});
