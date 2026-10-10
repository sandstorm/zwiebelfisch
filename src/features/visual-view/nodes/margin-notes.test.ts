// @vitest-environment jsdom
// Tests for margin-notes.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView } from '../visual-view';

function setup(source: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(source);
  const view = new VisualView(parent, doc);
  const cards = () => [...parent.querySelectorAll<HTMLElement>('[data-testid="typst-note-card"]')];
  const field = (i: number) => cards()[i].querySelector('textarea')!;
  const anchors = () => [...parent.querySelectorAll<HTMLElement>('[data-note-key]')].filter((a) => !a.matches('[data-testid="typst-note-card"]'));
  const text = parent.querySelector<HTMLElement>('[data-testid="typst-visual"]')!;
  return { doc, view, parent, cards, field, anchors, text };
}

function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Focuses `field`, types `text` and finishes with Mod+Enter (or Escape, or by leaving the field). */
function editCard(field: HTMLTextAreaElement, text: string, finish: 'save' | 'Escape' | 'blur' = 'save') {
  field.focus();
  expect(document.activeElement).toBe(field);
  field.value = text;
  if (finish === 'save') key(field, 'Enter', { ctrlKey: true });
  else if (finish === 'Escape') key(field, 'Escape');
  else field.blur();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the notes gutter', () => {
  it('shows a card for every point and range note, in document order', () => {
    const { parent, cards, field } = setup('Text#margin-note[first] and #margin-note[key][second].\n');
    expect(cards()).toHaveLength(2);
    expect([field(0).value, field(1).value]).toEqual(['first', 'second']);
    expect(cards()[1].querySelector('.typst-note-card__quote')?.textContent).toBe('key');
    expect(parent.querySelector('mark.typst-visual__note-range')?.textContent).toBe('key');
    expect(parent.querySelectorAll('[data-testid="typst-note-marker"]')).toHaveLength(1);
  });

  it('puts the gutter right of the text, in one body', () => {
    const { parent, text } = setup('Text#margin-note[n].\n');
    const body = parent.querySelector('.typst-visual__body')!;
    expect([...body.children].map((c) => c.className.split(' ')[0])).toEqual([text.className.split(' ')[0], 'typst-notes-gutter']);
  });

  it('edits a point note from its card, changing exactly its body', () => {
    const { doc, field } = setup('Text#margin-note(side: left)[old] more.\n');
    editCard(field(0), 'new note');
    expect(doc.text).toBe('Text#margin-note(side: left)[new note] more.\n');
    expect(field(0).value).toBe('new note');
  });

  it('edits the note of a range note, keeping the highlighted text', () => {
    const { doc, field } = setup('A #margin-note[key claim][old] here.\n');
    editCard(field(0), 'new');
    expect(doc.text).toBe('A #margin-note[key claim][new] here.\n');
  });

  it('saves when the field is left, and Mod+Enter puts the cursor back after the note', () => {
    const { doc, field, text } = setup('A #margin-note[key][old] here.\n');
    editCard(field(0), 'left', 'blur');
    expect(doc.text).toBe('A #margin-note[key][left] here.\n');
    editCard(field(0), 'saved');
    expect(doc.text).toBe('A #margin-note[key][saved] here.\n');
    expect(text.contains(document.activeElement)).toBe(true);
  });

  it('keeps several lines', () => {
    const { doc, field } = setup('Text#margin-note[old].\n');
    editCard(field(0), 'one\ntwo');
    expect(doc.text).toBe('Text#margin-note[one\ntwo].\n');
  });

  it('escapes a note whose markup would break out of its call', () => {
    const { doc, field } = setup('A #margin-note[key][old] and #margin-note[p] here.\n\nNext.\n');
    editCard(field(0), 'ends with \\');
    editCard(field(1), 'a // b');
    expect(doc.text).toBe('A #margin-note[key][ends with \\\\] and #margin-note[a \\// b] here.\n\nNext.\n');
    expect(field(1).value).toBe('a \\// b');
  });

  it('Escape leaves the note unchanged', () => {
    const { doc, field } = setup('Text#margin-note[old].\n');
    editCard(field(0), 'changed', 'Escape');
    expect(doc.text).toBe('Text#margin-note[old].\n');
    expect(field(0).value).toBe('old');
  });

  it('an edit is one undo step', () => {
    const source = 'A #margin-note[key][old] here.\n';
    const { doc, field, text } = setup(source);
    editCard(field(0), 'new');
    key(text, 'z', { ctrlKey: true });
    expect(doc.text).toBe(source);
  });

  describe('resolve', () => {
    const resolve = (card: HTMLElement) => card.querySelector<HTMLButtonElement>('button[aria-label="Resolve note"]')!.click();

    it('deletes a point note', () => {
      const { doc, cards } = setup('Text#margin-note[a] more.\n');
      resolve(cards()[0]);
      expect(doc.text).toBe('Text more.\n');
      expect(cards()).toHaveLength(0);
    });

    it('drops the call of a range note but keeps its text', () => {
      const { doc, cards } = setup('A #margin-note[key claim][note] here and #margin-note[x][y].\n');
      resolve(cards()[0]);
      expect(doc.text).toBe('A key claim here and #margin-note[x][y].\n');
      expect(cards()).toHaveLength(1);
    });

    it('is one undo step', () => {
      const source = 'A #margin-note[key][note] here.\n';
      const { doc, cards, text } = setup(source);
      resolve(cards()[0]);
      key(text, 'z', { ctrlKey: true });
      expect(doc.text).toBe(source);
    });
  });

  describe('an open card and changes from elsewhere', () => {
    for (const [kind, source, saved] of [
      ['range', 'Text #margin-note[key][old] here.\n', 'XXText #margin-note[key][typed] here.\n'],
      ['point', 'Text#margin-note[old] here.\n', 'XXText#margin-note[typed] here.\n'],
    ]) {
      it(`keeps the field of a ${kind} note and saves into that note`, () => {
        const { doc, field } = setup(source);
        const open = field(0);
        open.focus();
        open.value = 'typed';
        doc.change([{ from: 0, to: 0, insert: 'XX' }], 'remote');
        expect(field(0)).toBe(open);
        expect(open.value).toBe('typed');
        expect(document.activeElement).toBe(open);
        key(open, 'Enter', { ctrlKey: true });
        expect(doc.text).toBe(saved);
      });
    }

    it('keeps the card of a range note when its text changes', () => {
      const { doc, field } = setup('Text #margin-note[key][old] here.\n');
      const open = field(0);
      open.focus();
      open.value = 'typed';
      doc.change([{ from: 21, to: 21, insert: 's' }], 'remote');
      expect(field(0)).toBe(open);
      key(open, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe('Text #margin-note[keys][typed] here.\n');
    });

    it('keeps the card of a note when a note is added before it', () => {
      const { doc, field, cards } = setup('A b#margin-note[old] c.\n');
      const open = field(0);
      open.focus();
      open.value = 'typed';
      doc.change([{ from: 1, to: 1, insert: '#margin-note[new]' }], 'remote');
      expect(cards()).toHaveLength(2);
      expect(field(1)).toBe(open);
      key(open, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe('A#margin-note[new] b#margin-note[typed] c.\n');
    });

    it('does not save from a card whose note is gone', () => {
      const { doc, field } = setup('Text #margin-note[key][old] here.\n');
      const open = field(0);
      open.focus();
      open.value = 'typed';
      doc.setText('Other text.\n', 'remote');
      key(open, 'Enter', { ctrlKey: true });
      open.dispatchEvent(new FocusEvent('blur'));
      expect(doc.text).toBe('Other text.\n');
    });
  });

  it('follows notes changed in the source', () => {
    const { doc, field, cards } = setup('Text#margin-note[old] and #margin-note[x][y].\n');
    doc.setText('Text#margin-note[new] and #margin-note[x][z] #margin-note[3].\n', 'source');
    expect(cards().map((_, i) => field(i).value)).toEqual(['new', 'z', '3']);
  });

  describe('focus and hover', () => {
    it('a focused card makes its anchor active', () => {
      const { field, anchors } = setup('A #margin-note[key][n] and b#margin-note[p].\n');
      field(1).focus();
      expect(anchors().map((a) => a.classList.contains('typst-visual__note-anchor--active'))).toEqual([false, true]);
      field(0).focus();
      expect(anchors().map((a) => a.classList.contains('typst-visual__note-anchor--active'))).toEqual([true, false]);
    });

    it('the cursor in highlighted text makes its card active', () => {
      const source = 'A #margin-note[key][n] and more.\n';
      const { view, cards } = setup(source);
      view.reveal(source.indexOf('key') + 1, source.indexOf('key') + 1);
      expect(cards()[0].classList.contains('typst-note-card--active')).toBe(true);
      view.reveal(source.indexOf('more'), source.indexOf('more'));
      expect(cards()[0].classList.contains('typst-note-card--active')).toBe(false);
    });

    it('clicking a point note\'s marker focuses its card', () => {
      const { parent, field } = setup('A b#margin-note[p] c.\n');
      const marker = parent.querySelector<HTMLElement>('[data-testid="typst-note-marker"]')!;
      marker.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(field(0));
    });

    it('hovering a card highlights its anchor, and hovering an anchor its card', () => {
      const { cards, anchors } = setup('A #margin-note[key][n] and b#margin-note[p].\n');
      cards()[1].dispatchEvent(new MouseEvent('mouseenter'));
      expect(anchors()[1].classList.contains('typst-visual__note-anchor--hover')).toBe(true);
      cards()[1].dispatchEvent(new MouseEvent('mouseleave'));
      expect(anchors()[1].classList.contains('typst-visual__note-anchor--hover')).toBe(false);
      anchors()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(cards()[0].classList.contains('typst-note-card--hover')).toBe(true);
    });
  });

  it('places cards beside their anchors without overlap, in an animation frame', async () => {
    const tops: Record<string, number> = { n0: 10, n1: 20, n2: 300 };
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const key = this.getAttribute('data-note-key');
      const top = key && !this.matches('[data-testid="typst-note-card"]') ? tops[key] : 0;
      return new DOMRect(0, top, 10, 16);
    });
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
    try {
      const { cards } = setup('A #margin-note[a][1] b#margin-note[2]\n\nC #margin-note[c][3]\n');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(cards().map((card) => card.style.top)).toEqual(['10px', '68px', '300px']);
    } finally {
      rect.mockRestore();
      height.mockRestore();
    }
  });

  describe('editNote', () => {
    it('focuses the card of the note whose source holds the offset', () => {
      const source = 'Text#margin-note[] and #margin-note[x][].\n';
      const { view, field } = setup(source);
      expect(view.editNote(source.indexOf('[]') + 1)).toBe(true);
      expect(document.activeElement).toBe(field(0));
      expect(view.editNote(source.lastIndexOf('[]') + 1)).toBe(true);
      expect(document.activeElement).toBe(field(1));
      expect(view.editNote(0)).toBe(false);
    });

    it('picks the note whose source holds the offset among notes ending at the same place', () => {
      const source = '#margin-note[#margin-note[x][]][old] y\n';
      const { view } = setup(source);
      expect(view.editNote(source.indexOf('[]') + 1)).toBe(true);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe('');
      expect(view.editNote(source.indexOf('old'))).toBe(true);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe('old');
    });

    it('opens a range note, not the point note right after it', () => {
      const source = 'A #margin-note[x][first]#margin-note[second] b\n';
      const { view } = setup(source);
      expect(view.editNote(source.indexOf('first'))).toBe(true);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe('first');
      expect(view.editNote(source.indexOf('second'))).toBe(true);
      expect((document.activeElement as HTMLTextAreaElement).value).toBe('second');
      expect(view.editNote(source.indexOf(' b'))).toBe(false);
    });
  });
});
