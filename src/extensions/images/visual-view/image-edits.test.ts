// Tests for image-edits.ts.
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import { minimalChange } from '../../../core/typst-document/typst-document';
import { schema } from '../../../testing/testing';
import { imageInfo, resizeImage, setImageAlt } from './image-edits';
import { serializeToTypst, parseTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';

const state = (source: string) => EditorState.create({ doc: parseTypst(source, schema) });

/** The position of the first image block. */
function imagePos(s: EditorState): number {
  let found = -1;
  s.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'image') found = pos;
    return found < 0;
  });
  return found;
}

function apply(source: string, edit: (s: EditorState, pos: number) => Transaction | null): { text: string; after: EditorState } {
  const before = state(source);
  const tr = edit(before, imagePos(before));
  if (!tr) throw new Error('no edit');
  const after = before.apply(tr);
  return { text: serializeToTypst(after.doc), after };
}

describe('image edits', () => {
  it('report what the image tools can do', () => {
    const info = (source: string) => {
      const s = state(source);
      return imageInfo(s, imagePos(s));
    };
    expect(info('#image("a.png", alt: "A")')).toEqual({ alt: 'A', width: null });
    expect(info('#figure(image("a.png", width: 40%), caption: [x])')).toEqual({ alt: null, width: '40%' });
  });

  it('resize as one minimal change of the width argument', () => {
    const source = '#figure(image("a.png", width: 8cm, height: 2cm), caption: [x]) <a>\n';
    const { text } = apply(source, (s, pos) => resizeImage(s, pos, 42.4));
    expect(minimalChange(source, text)).toEqual({ from: source.indexOf('8cm'), to: source.indexOf('8cm') + 3, insert: '42%' });
    expect(apply('#image("a.png")\n', (s, pos) => resizeImage(s, pos, 50)).text).toBe('#image("a.png", width: 50%)\n');
  });

  it('set and remove the alt text', () => {
    expect(apply('#image("a.png")\n', (s, pos) => setImageAlt(s, pos, 'A cat')).text).toBe('#image("a.png", alt: "A cat")\n');
    expect(apply('#image("a.png", alt: "A cat")\n', (s, pos) => setImageAlt(s, pos, '')).text).toBe('#image("a.png")\n');
  });
});
