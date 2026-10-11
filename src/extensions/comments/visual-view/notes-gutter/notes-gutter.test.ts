// @vitest-environment jsdom
// Tests for notes-gutter.ts and note-card.ts (through VisualView): cards, threads, replies, editing, resolve, layout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../../core/typst-document/typst-document';
import { calculateMarginNoteChanges } from '../../model/add-margin-note';
import { localDate } from '../../model/note-thread';
import { createVisualView } from '../../../../testing/testing';
import { marginNotes } from '../margin-notes';
import { notesGutter, type NotesGutterOptions } from './notes-gutter';

/** A Visual view with margin notes and the notes gutter, written as `options.user`; `editNote` opens a note's card. */
function setup(source: string, options: NotesGutterOptions = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(source);
  const notes = notesGutter(options);
  const view = Object.assign(createVisualView(parent, doc, { contributions: [marginNotes({ comment: () => {} }), notes] }), {
    editNote: (offset: number) => notes.editNote(doc, offset),
  });
  const cards = () => [...parent.querySelectorAll<HTMLElement>('[data-testid="typst-note-card"]')];
  /** The reply box of card `i`. */
  const field = (i: number) => cards()[i].querySelector<HTMLTextAreaElement>('.typst-comments__card-reply')!;
  const messages = (i: number) => [...cards()[i].querySelectorAll<HTMLElement>('[data-testid="typst-note-message"]')];
  const texts = (i: number) => messages(i).map((m) => m.querySelector('.typst-comments__card-text')?.textContent);
  /** Opens message `m` of card `i` for editing; returns its text area. */
  const edit = (i: number, m: number) => {
    messages(i)[m].querySelector<HTMLButtonElement>('button[aria-label="Edit message"]')!.click();
    return cards()[i].querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit message"]')!;
  };
  const anchors = () => [...parent.querySelectorAll<HTMLElement>('[data-note-key]')].filter((a) => !a.matches('[data-testid="typst-note-card"]'));
  const text = parent.querySelector<HTMLElement>('[data-testid="typst-visual"]')!;
  return { doc, view, parent, cards, field, messages, texts, edit, anchors, text };
}

function key(target: HTMLElement, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Types `text` into a focused `field` and finishes with Mod+Enter (or Escape, or by leaving the field). */
function type(field: HTMLTextAreaElement, text: string, finish: 'save' | 'Escape' | 'blur' = 'save') {
  field.focus();
  expect(document.activeElement).toBe(field);
  field.value = text;
  if (finish === 'save') key(field, 'Enter', { ctrlKey: true });
  else if (finish === 'Escape') key(field, 'Escape');
  else field.blur();
}

const today = localDate();
const signed = (name: string, text: string) => `*${name}* (${today}): ${text}`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the notes gutter', () => {
  it('shows a card for every point and range note, in document order', () => {
    const { parent, cards, texts } = setup('Text#margin-note[first] and #margin-note[key][second].\n');
    expect(cards()).toHaveLength(2);
    expect([texts(0), texts(1)]).toEqual([['first'], ['second']]);
    expect(cards()[1].querySelector('.typst-comments__card-quote')?.textContent).toBe('key');
    expect(parent.querySelector('mark.typst-comments__range')?.textContent).toBe('key');
    expect(parent.querySelectorAll('[data-testid="typst-note-marker"]')).toHaveLength(1);
  });

  it('puts the gutter right of the text, in one body', () => {
    const { parent, text } = setup('Text#margin-note[n].\n');
    const body = parent.querySelector('.typst-visual__body')!;
    // then the toolbar's floating bars (selection, table), placed in the text column too
    expect([...body.children].map((c) => c.className.split(' ')[0])).toEqual([text.className.split(' ')[0], 'typst-comments__gutter', 'typst-floating-bar', 'typst-floating-bar']);
  });

  describe('threads', () => {
    const THREAD = '\n  - *Anna* (2026-10-10): Is this *right*?\n  - *Bob* (2026-10-11): Yes, \\#1.\n';

    it('shows each message with name, date and text, oldest first', () => {
      const { messages, texts } = setup(`A #margin-note[key][${THREAD}] b.\n`);
      expect(messages(0).map((m) => [m.querySelector('.typst-comments__card-author')?.textContent, m.querySelector('.typst-comments__card-date')?.textContent]))
        .toEqual([['Anna', '2026-10-10'], ['Bob', '2026-10-11']]);
      expect(texts(0)).toEqual(['Is this *right*?', 'Yes, #1.']);
    });

    it('a reply appends an item with the user\'s name and today\'s date (one undo step)', () => {
      const source = `A #margin-note[key][${THREAD}] b.\n`;
      const { doc, field, texts, text } = setup(source, { user: { name: 'Cleo' } });
      type(field(0), 'Fixed ] it *now*');
      expect(doc.text).toBe(`A #margin-note[key][${THREAD.trimEnd()}\n  - ${signed('Cleo', 'Fixed \\] it \\*now\\*')}\n] b.\n`);
      expect(texts(0)).toEqual(['Is this *right*?', 'Yes, #1.', 'Fixed ] it *now*']);
      expect(field(0).value).toBe('');
      key(text, 'z', { ctrlKey: true });
      expect(doc.text).toBe(source);
    });

    it('the send button sends too; an empty reply sends nothing', () => {
      const { doc, field, cards } = setup('A #margin-note[- *Anna* (2026-10-10): hi] b.\n', { user: { name: 'Bob' } });
      const send = cards()[0].querySelector<HTMLButtonElement>('button[aria-label="Send"]')!;
      send.click();
      expect(doc.text).toBe('A #margin-note[- *Anna* (2026-10-10): hi] b.\n');
      field(0).value = 'one\ntwo';
      send.click();
      expect(doc.text).toBe(`A #margin-note[- *Anna* (2026-10-10): hi\n- ${signed('Bob', 'one\\\n  two')}] b.\n`);
    });

    it('the first reply to a hand-written note keeps it as the first message, without name and date', () => {
      const { doc, field, texts } = setup('A #margin-note[key][Check *this*] b.\n', { user: { name: 'Bob' } });
      type(field(0), 'Done.');
      expect(doc.text).toBe(`A #margin-note[key][- Check *this*\n- ${signed('Bob', 'Done.')}] b.\n`);
      expect(texts(0)).toEqual(['Check *this*', 'Done.']);
    });

    it('the first message of a new note is sent when the box is left; a reply only with Mod+Enter', () => {
      const { doc, field } = setup('A #margin-note[] b.\n', { user: { name: 'Anna' } });
      expect(field(0).placeholder).toBe('Write a comment…');
      type(field(0), 'First', 'blur');
      expect(doc.text).toBe(`A #margin-note[- ${signed('Anna', 'First')}] b.\n`);
      expect(field(0).placeholder).toBe('Reply…');
      type(field(0), 'draft', 'blur');
      expect(doc.text).toBe(`A #margin-note[- ${signed('Anna', 'First')}] b.\n`);
      expect(field(0).value).toBe('draft');
    });

    it('the first message of a note on a selected bold word changes only the note', () => {
      const source = 'This is *bold* text.\n';
      const { doc, view, field } = setup(source, { user: { name: 'Anna' } });
      const word = source.indexOf('bold');
      view.reveal(word, word + 4);
      doc.change(calculateMarginNoteChanges(doc.text, view.selection())!.changes, 'comment');
      const made = doc.text;
      expect(made).toContain('This is #margin-note[*bold*][] text.');
      type(field(0), 'First');
      expect(doc.text).toBe(made.replace('[*bold*][]', `[*bold*][- ${signed('Anna', 'First')}]`));
    });

    it('own messages and unsigned ones can be edited, others\' not; only the last own message can be deleted', () => {
      const note = '- legacy\n- *Anna* (2026-10-10): mine\n- *Bob* (2026-10-11): his\n- *Anna* (2026-10-12): last';
      const { messages } = setup(`A #margin-note[${note}] b.\n`, { user: { name: 'Anna' } });
      const buttons = messages(0).map((m) => [...m.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')));
      expect(buttons).toEqual([['Edit message'], ['Edit message'], [], ['Edit message', 'Delete message']]);
    });

    it('edits an own message in place: only its text changes', () => {
      const { doc, edit, texts } = setup(`A #margin-note[key][${THREAD}] b.\n`, { user: { name: 'Bob' } });
      const area = edit(0, 1);
      expect(area.value).toBe('Yes, #1.');
      type(area, 'No, #2.');
      expect(doc.text).toBe(`A #margin-note[key][${THREAD.replace('Yes, \\#1.', 'No, \\#2.')}] b.\n`);
      expect(texts(0)).toEqual(['Is this *right*?', 'No, #2.']);
    });

    it('Escape ends editing a message without a change', () => {
      const source = `A #margin-note[key][${THREAD}] b.\n`;
      const { doc, edit, texts } = setup(source, { user: { name: 'Bob' } });
      type(edit(0, 1), 'changed', 'Escape');
      expect(doc.text).toBe(source);
      expect(texts(0)).toEqual(['Is this *right*?', 'Yes, #1.']);
    });

    it('deletes the last own message, and the note with its only message', () => {
      const { doc, messages, cards } = setup(`A #margin-note[key][${THREAD}] b#margin-note[- *Bob* (2026-10-11): x].\n`, { user: { name: 'Bob' } });
      messages(0)[1].querySelector<HTMLButtonElement>('button[aria-label="Delete message"]')!.click();
      expect(doc.text).toBe('A #margin-note[key][\n  - *Anna* (2026-10-10): Is this *right*?\n] b#margin-note[- *Bob* (2026-10-11): x].\n');
      messages(1)[0].querySelector<HTMLButtonElement>('button[aria-label="Delete message"]')!.click();
      expect(doc.text).toBe('A #margin-note[key][\n  - *Anna* (2026-10-10): Is this *right*?\n] b.\n');
      expect(cards()).toHaveLength(1);
    });

    it('collapses a long thread to the first and the last two messages, "n more" shows all', () => {
      const note = [1, 2, 3, 4, 5, 6].map((n) => `- *A* (2026-10-0${n}): m${n}`).join('\n');
      const { cards, texts } = setup(`A #margin-note[${note}] b.\n`);
      expect(texts(0)).toEqual(['m1', 'm5', 'm6']);
      const more = cards()[0].querySelector<HTMLButtonElement>('.typst-comments__card-more')!;
      expect(more.textContent).toBe('3 more');
      more.click();
      expect(texts(0)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    });

    it('signs as "Anonymous" without a user', () => {
      const { doc, field } = setup('A #margin-note[] b.\n');
      type(field(0), 'hi');
      expect(doc.text).toBe(`A #margin-note[- ${signed('Anonymous', 'hi')}] b.\n`);
    });
  });

  describe('a hand-written note: one unsigned message, edited as markup', () => {
    it('edits a point note from its card, changing exactly its body', () => {
      const { doc, edit, texts } = setup('Text#margin-note(side: left)[old] more.\n');
      type(edit(0, 0), 'new note');
      expect(doc.text).toBe('Text#margin-note(side: left)[new note] more.\n');
      expect(texts(0)).toEqual(['new note']);
    });

    it('edits the note of a range note, keeping the highlighted text', () => {
      const { doc, edit } = setup('A #margin-note[key claim][old] here.\n');
      type(edit(0, 0), 'new');
      expect(doc.text).toBe('A #margin-note[key claim][new] here.\n');
    });

    it('saves when the field is left, and Mod+Enter puts the cursor back after the note', () => {
      const { doc, edit, text } = setup('A #margin-note[key][old] here.\n');
      type(edit(0, 0), 'left', 'blur');
      expect(doc.text).toBe('A #margin-note[key][left] here.\n');
      type(edit(0, 0), 'saved');
      expect(doc.text).toBe('A #margin-note[key][saved] here.\n');
      expect(text.contains(document.activeElement)).toBe(true);
    });

    it('keeps several lines', () => {
      const { doc, edit } = setup('Text#margin-note[old].\n');
      type(edit(0, 0), 'one\ntwo');
      expect(doc.text).toBe('Text#margin-note[one\ntwo].\n');
    });

    it('escapes a note whose markup would break out of its call', () => {
      const { doc, edit, texts } = setup('A #margin-note[key][old] and #margin-note[p] here.\n\nNext.\n');
      type(edit(0, 0), 'ends with \\');
      type(edit(1, 0), 'a // b');
      expect(doc.text).toBe('A #margin-note[key][ends with \\\\] and #margin-note[a \\// b] here.\n\nNext.\n');
      expect(texts(1)).toEqual(['a \\// b']);
    });

    it('Escape leaves the note unchanged', () => {
      const { doc, edit, texts } = setup('Text#margin-note[old].\n');
      type(edit(0, 0), 'changed', 'Escape');
      expect(doc.text).toBe('Text#margin-note[old].\n');
      expect(texts(0)).toEqual(['old']);
    });

    it('an edit is one undo step', () => {
      const source = 'A #margin-note[key][old] here.\n';
      const { doc, edit, text } = setup(source);
      type(edit(0, 0), 'new');
      key(text, 'z', { ctrlKey: true });
      expect(doc.text).toBe(source);
    });
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
      ['range', 'Text #margin-note[key][] here.\n', `XXText #margin-note[key][- ${signed('Anonymous', 'typed')}] here.\n`],
      ['point', 'Text#margin-note[] here.\n', `XXText#margin-note[- ${signed('Anonymous', 'typed')}] here.\n`],
    ]) {
      it(`keeps the reply box of a ${kind} note and sends into that note`, () => {
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

    it('keeps a message being edited while a reply arrives, and saves into that message', () => {
      const { doc, edit, texts } = setup('A #margin-note[- *Anna* (2026-10-10): old] b.\n', { user: { name: 'Anna' } });
      const area = edit(0, 0);
      area.value = 'typed';
      doc.setText('A #margin-note[- *Anna* (2026-10-10): old\n- *Bob* (2026-10-11): reply] b.\n', 'remote');
      expect(document.activeElement).toBe(area);
      key(area, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe('A #margin-note[- *Anna* (2026-10-10): typed\n- *Bob* (2026-10-11): reply] b.\n');
      expect(texts(0)).toEqual(['typed', 'reply']);
    });

    it('keeps the card of a range note when its text changes', () => {
      const { doc, field } = setup('Text #margin-note[key][] here.\n');
      const open = field(0);
      open.focus();
      open.value = 'typed';
      doc.change([{ from: 21, to: 21, insert: 's' }], 'remote');
      expect(field(0)).toBe(open);
      key(open, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe(`Text #margin-note[keys][- ${signed('Anonymous', 'typed')}] here.\n`);
    });

    it('keeps the card of a note when a note is added before it', () => {
      const { doc, field, cards } = setup('A b#margin-note[] c.\n');
      const open = field(0);
      open.focus();
      open.value = 'typed';
      doc.change([{ from: 1, to: 1, insert: '#margin-note[new]' }], 'remote');
      expect(cards()).toHaveLength(2);
      expect(field(1)).toBe(open);
      key(open, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe(`A#margin-note[new] b#margin-note[- ${signed('Anonymous', 'typed')}] c.\n`);
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
    const { doc, texts, cards } = setup('Text#margin-note[old] and #margin-note[x][y].\n');
    doc.setText('Text#margin-note[new] and #margin-note[x][z] #margin-note[3].\n', 'source');
    expect(cards().map((_, i) => texts(i))).toEqual([['new'], ['z'], ['3']]);
  });

  describe('focus and hover', () => {
    it('a focused card makes its anchor active', () => {
      const { field, anchors } = setup('A #margin-note[key][n] and b#margin-note[p].\n');
      field(1).focus();
      expect(anchors().map((a) => a.classList.contains('typst-comments__anchor--active'))).toEqual([false, true]);
      field(0).focus();
      expect(anchors().map((a) => a.classList.contains('typst-comments__anchor--active'))).toEqual([true, false]);
    });

    it('the cursor in highlighted text makes its card active', () => {
      const source = 'A #margin-note[key][n] and more.\n';
      const { view, cards } = setup(source);
      view.reveal(source.indexOf('key') + 1, source.indexOf('key') + 1);
      expect(cards()[0].classList.contains('typst-comments__card--active')).toBe(true);
      view.reveal(source.indexOf('more'), source.indexOf('more'));
      expect(cards()[0].classList.contains('typst-comments__card--active')).toBe(false);
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
      expect(anchors()[1].classList.contains('typst-comments__anchor--hover')).toBe(true);
      cards()[1].dispatchEvent(new MouseEvent('mouseleave'));
      expect(anchors()[1].classList.contains('typst-comments__anchor--hover')).toBe(false);
      anchors()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      expect(cards()[0].classList.contains('typst-comments__card--hover')).toBe(true);
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

  it('keeps the column beside the text in half of a desktop window, and collapses it on a narrower pane', async () => {
    // half of a 1280px window, next to the side panels' rail: about 620px
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    try {
      const { doc, parent } = setup('A #margin-note[a][1] b\n');
      const narrow = () => parent.querySelector('.typst-visual__body')!.classList.contains('typst-comments--narrow');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(narrow()).toBe(false);
      width.mockReturnValue(500);
      doc.setText('A #margin-note[a][2] b\n', 'source');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(narrow()).toBe(true);
    } finally {
      width.mockRestore();
    }
  });

  describe('editNote', () => {
    /** The messages of the card whose reply box has the focus. */
    const focusedThread = () => [...(document.activeElement?.closest('[data-testid="typst-note-card"]')?.querySelectorAll('.typst-comments__card-text') ?? [])]
      .map((t) => t.textContent);

    it('focuses the reply box of the note whose source holds the offset', () => {
      const source = 'Text#margin-note[] and #margin-note[x][].\n';
      const { view, field } = setup(source);
      expect(view.editNote(source.indexOf('[]') + 1)).toBe(true);
      expect(document.activeElement).toBe(field(0));
      expect(view.editNote(source.lastIndexOf('[]') + 1)).toBe(true);
      expect(document.activeElement).toBe(field(1));
      expect(view.editNote(0)).toBe(false);
    });

    it('picks the note whose source holds the offset among notes ending at the same place', () => {
      const source = '#margin-note[#margin-note[x][inner]][old] y\n';
      const { view } = setup(source);
      expect(view.editNote(source.indexOf('inner'))).toBe(true);
      expect(focusedThread()).toEqual(['inner']);
      expect(view.editNote(source.indexOf('old'))).toBe(true);
      expect(focusedThread()).toEqual(['old']);
    });

    it('opens a range note, not the point note right after it', () => {
      const source = 'A #margin-note[x][first]#margin-note[second] b\n';
      const { view } = setup(source);
      expect(view.editNote(source.indexOf('first'))).toBe(true);
      expect(focusedThread()).toEqual(['first']);
      expect(view.editNote(source.indexOf('second'))).toBe(true);
      expect(focusedThread()).toEqual(['second']);
      expect(view.editNote(source.indexOf(' b'))).toBe(false);
    });
  });
});
