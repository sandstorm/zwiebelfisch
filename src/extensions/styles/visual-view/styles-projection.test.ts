// Tests for the projection of custom styles (visual-view.ts): declared style calls as styled blocks and text.
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { Style } from '../model/discover';
import type { ProjectStyles } from '../model/style-index';
import { print, project as projectWith } from '../../../hosts/projection/projection';
import { after, edit, expectPreciseMap, find, schemaWith } from '../../../testing/testing';
import { customStyles } from './visual-view';

const style = (name: string, kind: Style['kind'], label: string): Style => ({ name, kind, label, path: ProjectPath.of('/styles.typ') });
/** A project's styles that are `list`, never changing. */
function declaring(list: Style[]): ProjectStyles {
  return { styles: () => list, onDidChange: new EventEmitter<void>().event, calculateImportChange: () => null };
}

const STYLES = [style('note', 'paragraph', 'Note'), style('callout', 'paragraph', 'Callout'), style('key', 'text', 'Keyword')];

/** The schema of a view whose project declares `STYLES`. */
const schema = schemaWith({ contributions: [customStyles({ styles: declaring(STYLES), create: () => {} })] });

/** The schema of a view whose project declares no styles. */
const withoutStyles = schemaWith({ contributions: [customStyles({ styles: declaring([]), create: () => {} })] });

const project = (source: string): Node => projectWith(source, schema);

const FIXTURES: Record<string, string> = {
  block: 'Before\n\n#note[A *noted* paragraph.]\n\nAfter\n',
  blocks: '#note[\n  First.\n\n  - a list\n]\n',
  args: '#callout(kind: "warning")[Careful #key[now].]\n',
  empty: '#note[]\n',
  text: 'A #key[term] and #key[*bold* term] here, #key(size: 2)[sized].\n',
  nested: '#note[With #key[a key] and #link("https://typst.app")[#key[linked]].]\n',
  undeclared: '#other[x]\n\nSee #other[y] and #key[] and #note[inline] here.\n\n#note[a][b]\n',
  labelled: '#note[Labelled.] <n>\n',
};

describe('custom styles', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        expect(print(project(source))).toBe(source);
        expectPreciseMap(project(source));
      });
    }
  });

  it('projects a paragraph style call as a styled block holding blocks', () => {
    const block = project(FIXTURES.blocks).child(0);
    expect(block.type.name).toBe('styledBlock');
    expect(block.attrs).toMatchObject({ name: 'note', title: 'Note' });
    expect(block.child(0).textContent).toBe('First.');
    expect(block.child(1).type.name).toBe('bulletList');
  });

  it('projects a text style call as text with the style mark; formatting inside stays', () => {
    const paragraph = project(FIXTURES.text).child(0);
    const styled: string[] = [];
    paragraph.forEach((node) => {
      const style = node.marks.find((m) => m.type.name === 'style');
      if (style) styled.push(`${node.text}:${style.attrs.name}${node.marks.some((m) => m.type.name === 'bold') ? '+bold' : ''}`);
    });
    expect(styled).toEqual(['term:key', 'bold:key+bold', ' term:key', 'sized:key']);
  });

  it('keeps undeclared calls, inline paragraph styles, empty text styles and two content blocks as raw code', () => {
    const doc = project(FIXTURES.undeclared);
    expect(doc.child(0).type.name).toBe('rawBlock');
    const inline: string[] = [];
    doc.child(1).forEach((node) => node.type.name === 'rawInline' && inline.push(node.attrs.src));
    expect(inline).toEqual(['#other[y]', '#key[]', '#note[inline]']);
    expect(doc.child(2).type.name).toBe('rawBlock');
  });

  it('without the style declared, the call stays a raw block', () => {
    expect(projectWith(FIXTURES.block, withoutStyles).child(1).type.name).toBe('rawBlock');
  });

  it('editing styled text changes only that text', () => {
    const doc = edit(project(FIXTURES.args), (s) => s.tr.insertText(' really', after(s.doc, 'Careful')));
    expect(print(doc)).toBe(FIXTURES.args.replace('Careful', 'Careful really'));
    const typed = edit(project(FIXTURES.text), (s) => s.tr.insertText('s', after(s.doc, 'term')));
    expect(print(typed)).toBe(FIXTURES.text.replace('#key[term]', '#key[terms]'));
  });

  it('typing into an empty styled block fills its brackets', () => {
    const doc = edit(project(FIXTURES.empty), (s) => s.tr.insertText('Hi', 2));
    expect(print(doc)).toBe('#note[Hi]\n');
  });

  it('a new styled block prints #name[..] around its blocks; a new text style #name[..] around the text', () => {
    const doc = edit(project('One\n\nTwo\n'), (s) => {
      const paragraph = s.doc.child(0);
      return s.tr.replaceWith(0, paragraph.nodeSize, schema.nodes.styledBlock.create({ name: 'note', title: 'Note' }, paragraph));
    });
    expect(print(doc)).toBe('#note[One]\n\nTwo\n');
    const marked = edit(doc, (s) => s.tr.addMark(after(s.doc, 'T') - 1, after(s.doc, 'Two'), schema.marks.style.create({ name: 'key', title: 'Keyword' })));
    expect(print(marked)).toBe('#note[One]\n\n#key[Two]\n');
    expectPreciseMap(marked);
  });

  it('a styled block keeps its Typst label', () => {
    const { node } = find(project(FIXTURES.labelled), 'styledBlock');
    expect([node.attrs.title, node.attrs.label?.name]).toEqual(['Note', 'n']);
  });
});
