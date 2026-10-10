import { describe, expect, it } from 'vitest';
import { EditorState, NodeSelection, type Transaction } from '@tiptap/pm/state';
import { minimalChange } from '../core/typst-document/minimal-change';
import { schema } from './extensions';
import { addCaption, imageInfo, removeCaption, resizeImage, setImageAlt } from './image-edits';
import { print, project } from './projection';

const state = (source: string) => EditorState.create({ doc: project(source, schema) });

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
  return { text: print(after.doc), after };
}

describe('image edits', () => {
  it('add a caption to an image block by turning it into a figure, cursor in the caption', () => {
    const { text, after } = apply('Intro\n\n#image("a.png", width: 50%)\n\nOutro\n', addCaption);
    expect(text).toBe('Intro\n\n#figure(image("a.png", width: 50%), caption: [])\n\nOutro\n');
    expect(after.selection.$from.parent.type.name).toBe('figureCaption');
    const typed = after.apply(after.tr.insertText('A *cat*'));
    expect(print(typed.doc)).toBe('Intro\n\n#figure(image("a.png", width: 50%), caption: [A \\*cat\\*])\n\nOutro\n');
  });

  it('add a caption to a figure without one', () => {
    const { text } = apply('#figure(image("a.png"), placement: top) <a>\n', addCaption);
    expect(text).toBe('#figure(image("a.png"), caption: [], placement: top) <a>\n');
  });

  it('remove the caption of a plain figure by turning it back into an image block', () => {
    const { text, after } = apply('Intro\n\n#figure(image("a.png"), caption: [A *cat*])\n\nOutro\n', removeCaption);
    expect(text).toBe('Intro\n\n#image("a.png")\n\nOutro\n');
    expect((after.selection as NodeSelection).node.type.name).toBe('image');
  });

  it('remove only the caption of a figure with a label or other arguments', () => {
    const { text } = apply('#figure(\n  image("a.png"),\n  caption: [A],\n  kind: image,\n)\n<fig:a>\n', removeCaption);
    expect(text).toBe('#figure(\n  image("a.png"),\n  kind: image,\n)\n<fig:a>\n');
  });

  it('report what the image tools can do', () => {
    const info = (source: string) => {
      const s = state(source);
      return imageInfo(s, imagePos(s));
    };
    expect(info('#image("a.png", alt: "A")')).toEqual({ caption: false, alt: 'A', width: null });
    expect(info('#figure(image("a.png", width: 40%), caption: [x])')).toEqual({ caption: true, alt: null, width: '40%' });
    expect(info('#figure(image("a.png"))')?.caption).toBe(false);
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
