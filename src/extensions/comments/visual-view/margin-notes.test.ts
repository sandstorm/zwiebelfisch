// @vitest-environment jsdom
// Tests for margin-notes.ts: projecting and printing margin notes, and "Comment" in the Visual view's toolbar.
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { print } from '../../../hosts/visual-view/visual-view';
import { after, createVisualView, edit, expectPreciseMap, project as projectWith, schemaWith } from '../../../hosts/visual-view/test-support';
import { marginNotes, type MarginNotesOptions } from './margin-notes';

const schema = schemaWith({ contributions: [marginNotes()] });
const project = (source: string) => projectWith(source, schema);

const MARGIN_NOTES =
  '#import "@preview/drafting:0.2.2": margin-note\n\nSome text#margin-note[Is this right? -- Anna] and #margin-note[a *range*][the [note]] '
  + 'plus #margin-note(side: left, dy: 1em)[left][x].\n\n#margin-note[alone]\n\n#margin-note[][] #margin-note[a\n\nb][c] #margin-note([a], [b])\n';

describe('margin notes round trip', () => {
  it('prints every byte back', () => expect(print(project(MARGIN_NOTES))).toBe(MARGIN_NOTES));
  it('maps source offsets and document positions precisely', () => expectPreciseMap(project(MARGIN_NOTES)));
});

describe('margin notes', () => {
  const notes = (doc: Node) => {
    const found: { text: string; marks: string[] }[] = [];
    doc.descendants((node) => {
      if (node.isText) found.push({ text: node.text!, marks: node.marks.map((m) => `${m.type.name}:${m.attrs.head ?? ''}|${m.attrs.note ?? ''}`) });
    });
    return found;
  };

  it('projects a point note as a marginNote atom holding the head and the note', () => {
    const doc = project('Some text#margin-note[Is this right?] here.\n');
    const paragraph = doc.child(0);
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.child(1).type.name).toBe('marginNote');
    expect(paragraph.child(1).attrs).toEqual({ head: '#margin-note', note: 'Is this right?' });
  });

  it('projects a range note as editable text with a noteRange mark', () => {
    const doc = project('A #margin-note(side: left)[*key* claim][check this] here.\n');
    expect(notes(doc)).toEqual([
      { text: 'A ', marks: [] },
      { text: 'key', marks: ['noteRange:#margin-note(side: left)|check this', 'bold:|'] },
      { text: ' claim', marks: ['noteRange:#margin-note(side: left)|check this'] },
      { text: ' here.', marks: [] },
    ]);
  });

  it('makes a line holding only a note a paragraph', () => {
    expect(project('#margin-note[alone]\n').child(0).type.name).toBe('paragraph');
    expect(project('#margin-note[a][b]\n').child(0).type.name).toBe('paragraph');
  });

  it('keeps a line holding only a margin-note call it does not model a raw block', () => {
    expect(project('#margin-note(side: left, [x])\n').child(0).type.name).toBe('rawBlock');
    expect(project('#margin-note[a *b]\n').child(0).type.name).toBe('rawBlock');
  });

  it('keeps forms it does not model as raw inlines', () => {
    const doc = project('x #margin-note[][] #margin-note[a\n\nb][c] #margin-note([a], [b])\n');
    const raws: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === 'rawInline') raws.push(node.attrs.src);
    });
    expect(raws).toEqual(['#margin-note[][]', '#margin-note[a\n\nb][c]', '#margin-note([a], [b])']);
  });

  it('typing inside the highlighted text keeps the call and the note as written', () => {
    const source = 'A #margin-note(dy: 1em)[key claim][see *this*] here.\n';
    const doc = edit(project(source), (s) => s.tr.insertText(' new', after(s.doc, 'key')));
    expect(print(doc)).toBe('A #margin-note(dy: 1em)[key new claim][see *this*] here.\n');
  });

  it('prints an edited note of a range note in place', () => {
    const source = 'A #margin-note[key][old] here.\n';
    const doc = edit(project(source), (s) => {
      const end = after(s.doc, 'key');
      const mark = s.doc.nodeAt(end - 1)!.marks[0];
      return s.tr.removeMark(end - 3, end, mark).addMark(end - 3, end, mark.type.create({ ...mark.attrs, note: 'new' }));
    });
    expect(print(doc)).toBe('A #margin-note[key][new] here.\n');
  });

  it('prints an edited point note in place', () => {
    const source = 'Text#margin-note[old] more.\n';
    const doc = edit(project(source), (s) => s.tr.setNodeAttribute(after(s.doc, 'Text'), 'note', 'new'));
    expect(print(doc)).toBe('Text#margin-note[new] more.\n');
  });

  it('keeps nested range notes', () => {
    const source = '#margin-note[a #margin-note[b][inner] c][outer]\n';
    const doc = project(source);
    expect(notes(doc).find((n) => n.text === 'b')!.marks).toHaveLength(2);
    expect(print(edit(doc, (s) => s.tr.insertText('!', after(s.doc, 'a'))))).toBe('#margin-note[a! #margin-note[b][inner] c][outer]\n');
  });

  it('keeps adjacent range notes with the same call and note apart after an edit', () => {
    const source = 'x #margin-note[a][n]#margin-note[b][n] y\n';
    expect(print(edit(project(source), (s) => s.tr.insertText('Z', after(s.doc, 'x '))))).toBe('x Z#margin-note[a][n]#margin-note[b][n] y\n');
    const empty = 'x #margin-note[a][]#margin-note[b][] y\n';
    expect(print(edit(project(empty), (s) => s.tr.insertText('Z', after(s.doc, 'x '))))).toBe('x Z#margin-note[a][]#margin-note[b][] y\n');
    const bold = '*#margin-note[a][n]*#margin-note[b][n]\n';
    expect(print(edit(project(bold), (s) => s.tr.insertText('Z', s.doc.content.size - 1)))).toBe('#margin-note[#strong[a]][n]#margin-note[b][n]Z\n');
  });

  it('numbers range notes per textblock, so a source change elsewhere leaves their marks alone', () => {
    const doc = project('One #margin-note[a][n].\n\nTwo #margin-note[b][n].\n');
    const ids: unknown[] = [];
    doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'noteRange') ids.push(mark.attrs.id);
    });
    expect(ids).toEqual([0, 0]);
  });

  it('syncs a note changed in the source', () => {
    const parent = document.createElement('div');
    const doc = new TypstDocument('Text#margin-note[old] and #margin-note[x][y].\n');
    createVisualView(parent, doc, { contributions: [marginNotes()] });
    const target = 'Text#margin-note[new] and #margin-note[x][z].\n';
    doc.setText(target, 'test');
    const shown = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.state.doc;
    expect(shown.toJSON()).toEqual(project(target).toJSON());
    expect(print(shown)).toBe(target);
  });
});

function setup(text: string, options: MarginNotesOptions = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = createVisualView(parent, new TypstDocument(text), { contributions: [marginNotes(options)] });
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { view, button };
}

describe('Comment in the toolbar', () => {
  it('is there only with a `comment` option, and calls it', () => {
    expect(setup('Hello\n').button('Comment')).toBeNull();
    const comment = vi.fn();
    const { view, button } = setup('Hello world\n', { comment });
    view.reveal(6, 11);
    expect(button('Comment').title).toMatch(/^Comment \((Ctrl\+Alt\+M|⌘⌥M)\)$/);
    button('Comment').click();
    expect(comment).toHaveBeenCalledOnce();
  });

  it('is enabled with a caret or a selection in text, not in a code block', () => {
    const source = 'Hello world\n\n```\ncode\n```\n';
    const { view, button } = setup(source, { comment: () => {} });
    view.reveal(2, 2);
    expect(button('Comment').disabled).toBe(false);
    view.reveal(0, 5);
    expect(button('Comment').disabled).toBe(false);
    view.reveal(source.indexOf('code') + 1, source.indexOf('code') + 1);
    expect(button('Comment').disabled).toBe(true);
  });
});
