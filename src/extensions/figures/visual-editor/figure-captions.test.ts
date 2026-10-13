// @vitest-environment jsdom
// Tests for the figures' caption commands (visual-editor.ts): addFigureCaption / removeFigureCaption on an image body,
// with the built-ins (images, tables) offering the bodies.
import type { Editor } from '@tiptap/core';
import type { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { createEditor, find } from '../../../testing/testing';

/** An editor of `source`, and the position of its first image. */
function setup(source: string): { editor: Editor; text: () => string; image: () => number } {
  const editor = createEditor(source);
  return { editor, text: () => serializeToTypst(editor.state.doc), image: () => find(editor.state.doc, 'image').pos };
}

describe('figure captions', () => {
  it('add a caption to an image block by turning it into a figure, cursor in the caption', () => {
    const { editor, text, image } = setup('Intro\n\n#image("a.png", width: 50%)\n\nOutro\n');
    expect(editor.commands.addFigureCaption(image())).toBe(true);
    expect(text()).toBe('Intro\n\n#figure(image("a.png", width: 50%), caption: [])\n\nOutro\n');
    expect(editor.state.selection.$from.parent.type.name).toBe('figureCaption');
    editor.commands.insertContent('A *cat*');
    expect(text()).toBe('Intro\n\n#figure(image("a.png", width: 50%), caption: [A \\*cat\\*])\n\nOutro\n');
  });

  it("moves the image's label to the figure", () => {
    const { editor, text, image } = setup('#image("a.png") <a>\n');
    editor.commands.addFigureCaption(image());
    expect(text()).toBe('#figure(image("a.png"), caption: []) <a>\n');
  });

  it('add a caption to a figure without one', () => {
    const { editor, text, image } = setup('#figure(image("a.png"), placement: top) <a>\n');
    editor.commands.addFigureCaption(image());
    expect(text()).toBe('#figure(image("a.png"), caption: [], placement: top) <a>\n');
  });

  it('remove the caption of a plain figure by turning it back into an image block', () => {
    const { editor, text } = setup('Intro\n\n#figure(image("a.png"), caption: [A *cat*])\n\nOutro\n');
    editor.commands.removeFigureCaption(find(editor.state.doc, 'image').pos);
    expect(text()).toBe('Intro\n\n#image("a.png")\n\nOutro\n');
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('image');
  });

  it('remove only the caption of a figure with a label or other arguments', () => {
    for (const [source, result] of [
      ['#figure(\n  image("a.png"),\n  caption: [A],\n  kind: image,\n)\n<fig:a>\n', '#figure(\n  image("a.png"),\n  kind: image,\n)\n<fig:a>\n'],
      ['#figure(image("a.png"), caption: [x]) <a>\n', '#figure(image("a.png")) <a>\n'],
      ['#figure(image("a.png"), caption: [x], placement: top)\n', '#figure(image("a.png"), placement: top)\n'],
    ]) {
      const { editor, text, image } = setup(source);
      editor.commands.removeFigureCaption(image());
      expect(text()).toBe(result);
    }
  });

  it('tells, dry-run, which of the two applies', () => {
    const can = (source: string) => {
      const { editor, image } = setup(source);
      return { add: editor.can().addFigureCaption(image()), remove: editor.can().removeFigureCaption(image()) };
    };
    expect(can('#image("a.png")\n')).toEqual({ add: true, remove: false });
    expect(can('#figure(image("a.png"))\n')).toEqual({ add: true, remove: false });
    expect(can('#figure(image("a.png"), caption: [x])\n')).toEqual({ add: false, remove: true });
  });

  it('applies to figure bodies only', () => {
    const editor = createEditor('Text\n');
    expect(editor.can().addFigureCaption(1)).toBe(false);
  });
});

describe('figure bodies', () => {
  it('take their figure along when deleted', () => {
    const { editor, text, image } = setup('Intro\n\n#figure(image("a.png"), caption: [A cat]) <fig:a>\n\nOutro\n');
    editor.commands.setNodeSelection(image());
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(text()).toBe('Intro\n\nOutro\n');
  });

  it('set the caption as plain text, making the figure; an empty one removes it', () => {
    const { editor, text, image } = setup('#image("a.png")\n');
    editor.commands.setFigureCaption(image(), 'A *cat*');
    expect(text()).toBe('#figure(image("a.png"), caption: [A \\*cat\\*])\n');
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('image');
    editor.commands.setFigureCaption(image(), 'A dog');
    expect(text()).toBe('#figure(image("a.png"), caption: [A dog])\n');
    editor.commands.setFigureCaption(image(), '');
    expect(text()).toBe('#image("a.png")\n');
  });
});
