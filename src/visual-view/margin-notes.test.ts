// @vitest-environment jsdom
import './jsdom-setup';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const bubbles = () => [...parent.querySelectorAll<HTMLElement>('[data-testid="typst-margin-note"]')];
  return { doc, view, parent, bubbles };
}

function key(target: HTMLElement, name: string) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Clicks `bubble`, types `text` into its field and presses `finish`. */
function editBubble(bubble: HTMLElement, text: string, finish = 'Enter') {
  bubble.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  const field = bubble.querySelector('textarea')!;
  expect(document.activeElement).toBe(field);
  field.value = text;
  key(field, finish);
}

describe('margin notes in the Visual view', () => {
  it('shows a bubble with the note of point and range notes', () => {
    const { parent, bubbles } = setup('Text#margin-note[first] and #margin-note[key][second].\n');
    expect(bubbles().map((b) => b.textContent)).toEqual(['first', 'second']);
    expect(parent.querySelector('mark.typst-visual__note-range')?.textContent).toBe('key');
  });

  it('edits a point note in place, changing exactly its body', () => {
    const { doc, bubbles } = setup('Text#margin-note(side: left)[old] more.\n');
    editBubble(bubbles()[0], 'new note');
    expect(doc.text).toBe('Text#margin-note(side: left)[new note] more.\n');
    expect(bubbles()[0].textContent).toBe('new note');
  });

  it('edits the note of a range note in place, keeping the highlighted text', () => {
    const { doc, bubbles } = setup('A #margin-note[key claim][old] here.\n');
    editBubble(bubbles()[0], 'new');
    expect(doc.text).toBe('A #margin-note[key claim][new] here.\n');
  });

  it('escapes a note whose markup would break out of its call', () => {
    const { doc, bubbles } = setup('A #margin-note[key][old] and #margin-note[p] here.\n\nNext.\n');
    editBubble(bubbles()[0], 'ends with \\');
    editBubble(bubbles()[1], 'a // b');
    expect(doc.text).toBe('A #margin-note[key][ends with \\\\] and #margin-note[a \\// b] here.\n\nNext.\n');
  });

  describe('an open note editor and changes from elsewhere', () => {
    /** Opens the editor of the first bubble and types `text` without finishing. */
    function typeInto(bubbles: () => HTMLElement[], text: string) {
      bubbles()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      const field = bubbles()[0].querySelector('textarea')!;
      field.value = text;
      return field;
    }

    for (const [kind, source, saved] of [
      ['range', 'Text #margin-note[key][old] here.\n', 'XXText #margin-note[key][typed] here.\n'],
      ['point', 'Text#margin-note[old] here.\n', 'XXText#margin-note[typed] here.\n'],
    ]) {
      it(`keeps the field of a ${kind} note and saves into that note`, () => {
        const { doc, bubbles } = setup(source);
        const field = typeInto(bubbles, 'typed');
        doc.change([{ from: 0, to: 0, insert: 'XX' }], 'remote');
        expect(field.isConnected).toBe(true);
        expect(document.activeElement).toBe(field);
        key(field, 'Enter');
        expect(doc.text).toBe(saved);
      });
    }

    it('keeps the field of a range note when its text changes', () => {
      const { doc, bubbles } = setup('Text #margin-note[key][old] here.\n');
      const field = typeInto(bubbles, 'typed');
      doc.change([{ from: 21, to: 21, insert: 's' }], 'remote');
      expect(field.isConnected).toBe(true);
      key(field, 'Enter');
      expect(doc.text).toBe('Text #margin-note[keys][typed] here.\n');
    });

    it('does not save from a field whose note is gone', () => {
      const { doc, bubbles } = setup('Text #margin-note[key][old] here.\n');
      const field = typeInto(bubbles, 'typed');
      doc.setText('Other text.\n', 'remote');
      key(field, 'Enter');
      field.dispatchEvent(new FocusEvent('blur'));
      expect(doc.text).toBe('Other text.\n');
    });
  });

  it('Escape leaves the note unchanged', () => {
    const { doc, bubbles } = setup('Text#margin-note[old].\n');
    editBubble(bubbles()[0], 'changed', 'Escape');
    expect(doc.text).toBe('Text#margin-note[old].\n');
  });

  it('follows notes changed in the source', () => {
    const { doc, bubbles } = setup('Text#margin-note[old] and #margin-note[x][y].\n');
    doc.setText('Text#margin-note[new] and #margin-note[x][z].\n', 'source');
    expect(bubbles().map((b) => b.textContent)).toEqual(['new', 'z']);
  });

  it('editNote opens the note whose source holds the offset', () => {
    const source = 'Text#margin-note[] and #margin-note[x][].\n';
    const { view, bubbles } = setup(source);
    expect(view.editNote(source.indexOf('[]') + 1)).toBe(true);
    expect(document.activeElement).toBe(bubbles()[0].querySelector('textarea'));
    expect(view.editNote(source.lastIndexOf('[]') + 1)).toBe(true);
    expect(document.activeElement).toBe(bubbles()[1].querySelector('textarea'));
    expect(view.editNote(0)).toBe(false);
  });
});
