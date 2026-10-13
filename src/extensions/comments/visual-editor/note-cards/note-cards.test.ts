// @vitest-environment jsdom
// Tests for note-cards.ts and note-card.ts (through VisualEditor): markers, the floating card, threads, replies, editing, resolve.
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceOffset, SourceRange, TypstDocument } from '../../../../core/typst-document/typst-document';
import { calculateMarginNoteChanges } from '../../model/add-margin-note';
import { localDate } from '../../model/note-thread';
import { createVisualEditor } from '../../../../testing/testing';
import { marginNotes } from '../margin-notes';
import { noteCards, type NoteCardsOptions } from './note-cards';

/** A Visual editor with margin notes and their cards, written as `options.user`; `editNote` opens a note's card. */
function setup(source: string, options: NoteCardsOptions = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(source);
  const notes = noteCards(options);
  const view = Object.assign(createVisualEditor(parent, doc, { contributions: [marginNotes({ comment: () => {} }), notes] }), {
    editNote: (offset: number) => notes.editNote(doc, SourceOffset.of(offset)),
  });
  const text = parent.querySelector<HTMLElement>('[data-testid="zwf-visual"]')!;
  const tiptap = () => (text as HTMLElement & { editor: Editor }).editor;
  const markers = () => [...parent.querySelectorAll<HTMLElement>('[data-testid="zwf-note-marker"]')];
  /** Opens the card of the note of marker `i` (a press on it). */
  const open = (i: number) => markers()[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  /** The open card (one at a time). */
  const card = () => parent.querySelector<HTMLElement>('[data-testid="zwf-note-card"]');
  const field = () => card()!.querySelector<HTMLTextAreaElement>('.zwf-comments__card-reply')!;
  const messages = () => [...card()!.querySelectorAll<HTMLElement>('[data-testid="zwf-note-message"]')];
  const texts = () => messages().map((m) => m.querySelector('.zwf-comments__card-text')?.textContent);
  const button = (label: string) => card()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  /** Opens message `m` for editing; returns its text area. */
  const edit = (m: number) => {
    messages()[m].querySelector<HTMLButtonElement>('button[aria-label="Edit message"]')!.click();
    return card()!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit message"]')!;
  };
  return { doc, view, parent, text, tiptap, markers, open, card, field, messages, texts, button, edit };
}

function key(target: Element, name: string, init: KeyboardEventInit = {}) {
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
const THREAD = '\n  - *Anna* (2026-10-10): Is this *right*?\n  - *Bob* (2026-10-11): Yes, \\#1.\n';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('markers in the text', () => {
  it('shows a marker per note: a point note, and one after a range note\'s highlighted text', () => {
    const { parent, markers, card } = setup('Text#margin-note[first] and #margin-note[key][second].\n');
    expect(markers()).toHaveLength(2);
    expect(parent.querySelector('mark.zwf-comments__range')?.textContent).toBe('key');
    // the range note's marker sits at the end of its text
    expect(markers()[1].previousSibling?.textContent).toBe('key');
    expect(card()).toBeNull();
  });

  it('tells the first message\'s author and first words as a tooltip', () => {
    const long = 'A long first message that goes on and on, much longer than a tooltip should be';
    const { markers, parent } = setup(`A #margin-note[key][${THREAD}] b#margin-note[- *Cleo* (2026-10-12): ${long}] c#margin-note[].\n`);
    expect(markers().map((m) => m.title)).toEqual([
      'Anna: Is this *right*?',
      'Cleo: A long first message that goes on and on, much longer than…',
      'Empty comment',
    ]);
    const highlighted = [...parent.querySelectorAll<HTMLElement>('[data-note-key]')].find((anchor) => anchor.textContent === 'key');
    expect(highlighted?.title).toBe('Anna: Is this *right*?');
  });

  it('follows notes changed in the source', () => {
    const { doc, markers } = setup('Text#margin-note[old] and #margin-note[x][y].\n');
    doc.setText('Text#margin-note[new] and #margin-note[x][z] #margin-note[3].\n', 'source');
    expect(markers().map((m) => m.title)).toEqual(['new', 'z', '3']);
  });
});

describe('the floating card', () => {
  it('opens at a press on a marker, a dialog with the focus in its reply box, in the text column', () => {
    const { parent, open, card, field, texts, text } = setup('Text#margin-note[first] and #margin-note[key][second].\n');
    open(1);
    expect(card()!.getAttribute('role')).toBe('dialog');
    expect(card()!.getAttribute('aria-label')).toBe('Comment on “key”');
    expect(card()!.querySelector('.zwf-comments__card-quote')?.textContent).toBe('key');
    expect(texts()).toEqual(['second']);
    expect(document.activeElement).toBe(field());
    expect(card()!.parentElement).toBe(parent.querySelector('.zwf-visual__body'));
    expect([...text.querySelectorAll('.zwf-comments__anchor--active')].map((anchor) => anchor.textContent)).toContain('key');
    // one card at a time
    open(0);
    expect(parent.querySelectorAll('[data-testid="zwf-note-card"]')).toHaveLength(1);
    expect(texts()).toEqual(['first']);
  });

  it('sits below its marker', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.matches('.zwf-visual__body')) return new DOMRect(10, 100, 500, 1000);
      if (this.matches('.zwf-comments__note')) return new DOMRect(110, 140, 16, 20);
      return new DOMRect(0, 0, 0, 0);
    });
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(500);
    try {
      const { open, card } = setup('A b#margin-note[p] c.\n');
      open(0);
      expect([card()!.style.left, card()!.style.top]).toEqual(['92px', '64px']);
    } finally {
      rect.mockRestore();
      width.mockRestore();
    }
  });

  it('Escape closes it and puts the focus back into the text, after the note', () => {
    const source = 'A #margin-note[key][n] and more.\n';
    const { view, open, card, field, text } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('more'), to: source.indexOf('more') }));
    open(0);
    key(field(), 'Escape');
    expect(card()).toBeNull();
    expect(text.contains(document.activeElement)).toBe(true);
    expect(view.selection().from).toBeGreaterThanOrEqual(source.indexOf(']['));
    expect(view.selection().from).toBeLessThanOrEqual(source.indexOf(' and'));
  });

  it('"Close" closes it, too', () => {
    const { open, card, button, text } = setup('A b#margin-note[p] c.\n');
    open(0);
    button('Close').click();
    expect(card()).toBeNull();
    expect(text.contains(document.activeElement)).toBe(true);
  });

  it('a press outside closes it; a press inside does not', () => {
    const { open, card, field } = setup('A b#margin-note[p] c.\n');
    open(0);
    card()!.querySelector('.zwf-comments__card-thread')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(field());
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
  });

  it('keeps Tab and Shift+Tab inside the card', () => {
    const { open, card, field, button } = setup('A b#margin-note[- *Anna* (2026-10-10): hi] c.\n', { user: { name: 'Anna' } });
    open(0);
    const send = button('Send');
    send.focus();
    expect(key(send, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button('Resolve note'));
    expect(key(button('Resolve note'), 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(send);
    // in between, the browser moves on
    field().focus();
    expect(key(field(), 'Tab').defaultPrevented).toBe(false);
    expect(card()).not.toBeNull();
  });

  it('Alt+Enter opens the card of the note at the caret: in highlighted text, or beside a point note', () => {
    const source = 'A #margin-note[key][range] b#margin-note[point] c.\n';
    const { view, text, card, texts, field } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('key') + 1, to: source.indexOf('key') + 1 }));
    expect(key(text, 'Enter', { altKey: true }).defaultPrevented).toBe(true);
    expect(texts()).toEqual(['range']);
    expect(document.activeElement).toBe(field());
    key(field(), 'Escape');
    view.reveal(SourceRange.of({ from: source.indexOf(' c.'), to: source.indexOf(' c.') }));
    key(text, 'Enter', { altKey: true });
    expect(texts()).toEqual(['point']);
    key(field(), 'Escape');
    view.reveal(SourceRange.of({ from: 0, to: 0 }));
    expect(key(text, 'Enter', { altKey: true }).defaultPrevented).toBe(false);
    expect(card()).toBeNull();
  });

  it('a click into highlighted text shows its card, the focus stays in the text; the card closes when the caret leaves', () => {
    const source = 'A #margin-note[key][range] and more.\n';
    const { view, tiptap, card, texts, text } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('key') + 1, to: source.indexOf('key') + 1 }));
    const { view: pm } = tiptap();
    pm.someProp('handleClick', (click) => click(pm, pm.state.selection.head, new MouseEvent('click')));
    expect(texts()).toEqual(['range']);
    expect(text.contains(document.activeElement)).toBe(true);
    view.reveal(SourceRange.of({ from: source.indexOf('key') + 2, to: source.indexOf('key') + 2 }));
    expect(card()).not.toBeNull();
    key(text, 'Escape');
    expect(card()).toBeNull();
    pm.someProp('handleClick', (click) => click(pm, pm.state.selection.head, new MouseEvent('click')));
    view.reveal(SourceRange.of({ from: source.indexOf('more'), to: source.indexOf('more') }));
    expect(card()).toBeNull();
  });

  it('a click into highlighted text from elsewhere puts the caret there (opening the card must not keep the caret from before)', () => {
    const source = 'A #margin-note[key][range] and more.\n';
    const { view, tiptap, texts } = setup(source);
    const { view: pm } = tiptap();
    view.reveal(SourceRange.of({ from: source.indexOf('key') + 1, to: source.indexOf('key') + 1 }));
    const clicked = pm.state.selection.head;
    view.reveal(SourceRange.of({ from: source.indexOf('more'), to: source.indexOf('more') }));
    // ProseMirror asks handleClick before it reads the click's caret from the DOM
    pm.someProp('handleClick', (click) => click(pm, clicked, new MouseEvent('click')));
    expect(texts()).toEqual(['range']);
    expect(pm.state.selection.head).toBe(clicked);
  });
});

describe('threads', () => {
  it('shows each message with name, date and text, oldest first', () => {
    const { open, messages, texts } = setup(`A #margin-note[key][${THREAD}] b.\n`);
    open(0);
    expect(messages().map((m) => [m.querySelector('.zwf-comments__card-author')?.textContent, m.querySelector('.zwf-comments__card-date')?.textContent]))
      .toEqual([['Anna', '2026-10-10'], ['Bob', '2026-10-11']]);
    expect(texts()).toEqual(['Is this *right*?', 'Yes, #1.']);
  });

  it('a reply appends an item with the user\'s name and today\'s date (one undo step); the card stays open', () => {
    const source = `A #margin-note[key][${THREAD}] b.\n`;
    const { doc, open, field, texts, text } = setup(source, { user: { name: 'Cleo' } });
    open(0);
    type(field(), 'Fixed ] it *now*');
    expect(doc.text).toBe(`A #margin-note[key][${THREAD.trimEnd()}\n  - ${signed('Cleo', 'Fixed \\] it \\*now\\*')}\n] b.\n`);
    expect(texts()).toEqual(['Is this *right*?', 'Yes, #1.', 'Fixed ] it *now*']);
    expect(field().value).toBe('');
    expect(document.activeElement).toBe(field());
    key(text, 'z', { ctrlKey: true });
    expect(doc.text).toBe(source);
  });

  it('the send button sends too; an empty reply sends nothing', () => {
    const { doc, open, field, button } = setup('A #margin-note[- *Anna* (2026-10-10): hi] b.\n', { user: { name: 'Bob' } });
    open(0);
    button('Send').click();
    expect(doc.text).toBe('A #margin-note[- *Anna* (2026-10-10): hi] b.\n');
    field().value = 'one\ntwo';
    button('Send').click();
    expect(doc.text).toBe(`A #margin-note[- *Anna* (2026-10-10): hi\n- ${signed('Bob', 'one\\\n  two')}] b.\n`);
  });

  it('the first reply to a hand-written note keeps it as the first message, without name and date', () => {
    const { doc, open, field, texts } = setup('A #margin-note[key][Check *this*] b.\n', { user: { name: 'Bob' } });
    open(0);
    type(field(), 'Done.');
    expect(doc.text).toBe(`A #margin-note[key][- Check *this*\n- ${signed('Bob', 'Done.')}] b.\n`);
    expect(texts()).toEqual(['Check *this*', 'Done.']);
  });

  it('closing sends the first message of a new note; a reply stays a draft until sent', () => {
    const { doc, open, field, card } = setup('A #margin-note[] b.\n', { user: { name: 'Anna' } });
    open(0);
    expect(field().placeholder).toBe('Write a comment…');
    type(field(), 'First', 'Escape');
    expect(doc.text).toBe(`A #margin-note[- ${signed('Anna', 'First')}] b.\n`);
    expect(card()).toBeNull();
    open(0);
    expect(field().placeholder).toBe('Reply…');
    field().value = 'draft';
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
    expect(doc.text).toBe(`A #margin-note[- ${signed('Anna', 'First')}] b.\n`);
    open(0);
    expect(field().value).toBe('draft');
  });

  it('the first message of a note on a selected bold word changes only the note', () => {
    const source = 'This is *bold* text.\n';
    const { doc, view, field } = setup(source, { user: { name: 'Anna' } });
    const word = source.indexOf('bold');
    view.reveal(SourceRange.of({ from: word, to: word + 4 }));
    const added = calculateMarginNoteChanges(doc.text, view.selection())!;
    doc.change(added.changes, 'comment');
    const made = doc.text;
    expect(made).toContain('This is #margin-note[*bold*][] text.');
    expect(view.editNote(added.note)).toBe(true);
    type(field(), 'First');
    expect(doc.text).toBe(made.replace('[*bold*][]', `[*bold*][- ${signed('Anna', 'First')}]`));
  });

  it('own messages and unsigned ones can be edited, others\' not; only the last own message can be deleted', () => {
    const note = '- legacy\n- *Anna* (2026-10-10): mine\n- *Bob* (2026-10-11): his\n- *Anna* (2026-10-12): last';
    const { open, messages } = setup(`A #margin-note[${note}] b.\n`, { user: { name: 'Anna' } });
    open(0);
    const buttons = messages().map((m) => [...m.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')));
    expect(buttons).toEqual([['Edit message'], ['Edit message'], [], ['Edit message', 'Delete message']]);
  });

  it('edits an own message in place: only its text changes; the reply box gets the focus back', () => {
    const { doc, open, edit, texts, field } = setup(`A #margin-note[key][${THREAD}] b.\n`, { user: { name: 'Bob' } });
    open(0);
    const area = edit(1);
    expect(area.value).toBe('Yes, #1.');
    type(area, 'No, #2.');
    expect(doc.text).toBe(`A #margin-note[key][${THREAD.replace('Yes, \\#1.', 'No, \\#2.')}] b.\n`);
    expect(texts()).toEqual(['Is this *right*?', 'No, #2.']);
    expect(document.activeElement).toBe(field());
  });

  it('Escape ends editing a message without a change, and leaves the card open', () => {
    const source = `A #margin-note[key][${THREAD}] b.\n`;
    const { doc, open, edit, texts, card } = setup(source, { user: { name: 'Bob' } });
    open(0);
    type(edit(1), 'changed', 'Escape');
    expect(doc.text).toBe(source);
    expect(texts()).toEqual(['Is this *right*?', 'Yes, #1.']);
    expect(card()).not.toBeNull();
  });

  it('deletes the last own message, and the note with its only message (the card closes)', () => {
    const { doc, open, messages, card, text } = setup(`A #margin-note[key][${THREAD}] b#margin-note[- *Bob* (2026-10-11): x].\n`, { user: { name: 'Bob' } });
    open(0);
    messages()[1].querySelector<HTMLButtonElement>('button[aria-label="Delete message"]')!.click();
    expect(doc.text).toBe('A #margin-note[key][\n  - *Anna* (2026-10-10): Is this *right*?\n] b#margin-note[- *Bob* (2026-10-11): x].\n');
    open(1);
    messages()[0].querySelector<HTMLButtonElement>('button[aria-label="Delete message"]')!.click();
    expect(doc.text).toBe('A #margin-note[key][\n  - *Anna* (2026-10-10): Is this *right*?\n] b.\n');
    expect(card()).toBeNull();
    expect(text.contains(document.activeElement)).toBe(true);
  });

  it('collapses a long thread to the first and the last two messages, "n more" shows all', () => {
    const note = [1, 2, 3, 4, 5, 6].map((n) => `- *A* (2026-10-0${n}): m${n}`).join('\n');
    const { open, card, texts } = setup(`A #margin-note[${note}] b.\n`);
    open(0);
    expect(texts()).toEqual(['m1', 'm5', 'm6']);
    const more = card()!.querySelector<HTMLButtonElement>('.zwf-comments__card-more')!;
    expect(more.textContent).toBe('3 more');
    more.click();
    expect(texts()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  });

  it('signs as "Anonymous" without a user', () => {
    const { doc, open, field } = setup('A #margin-note[] b.\n');
    open(0);
    type(field(), 'hi');
    expect(doc.text).toBe(`A #margin-note[- ${signed('Anonymous', 'hi')}] b.\n`);
  });
});

describe('a hand-written note: one unsigned message, edited as markup', () => {
  it('edits a point note, changing exactly its body', () => {
    const { doc, open, edit, texts } = setup('Text#margin-note(side: left)[old] more.\n');
    open(0);
    type(edit(0), 'new note');
    expect(doc.text).toBe('Text#margin-note(side: left)[new note] more.\n');
    expect(texts()).toEqual(['new note']);
  });

  it('edits the note of a range note, keeping the highlighted text', () => {
    const { doc, open, edit } = setup('A #margin-note[key claim][old] here.\n');
    open(0);
    type(edit(0), 'new');
    expect(doc.text).toBe('A #margin-note[key claim][new] here.\n');
  });

  it('saves when the field is left, and when the card closes', () => {
    const { doc, open, edit, card } = setup('A #margin-note[key][old] here.\n');
    open(0);
    type(edit(0), 'left', 'blur');
    expect(doc.text).toBe('A #margin-note[key][left] here.\n');
    edit(0).value = 'closed';
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(card()).toBeNull();
    expect(doc.text).toBe('A #margin-note[key][closed] here.\n');
  });

  it('keeps several lines', () => {
    const { doc, open, edit } = setup('Text#margin-note[old].\n');
    open(0);
    type(edit(0), 'one\ntwo');
    expect(doc.text).toBe('Text#margin-note[one\ntwo].\n');
  });

  it('escapes a note whose markup would break out of its call', () => {
    const { doc, open, edit, texts } = setup('A #margin-note[key][old] and #margin-note[p] here.\n\nNext.\n');
    open(0);
    type(edit(0), 'ends with \\');
    open(1);
    type(edit(0), 'a // b');
    expect(doc.text).toBe('A #margin-note[key][ends with \\\\] and #margin-note[a \\// b] here.\n\nNext.\n');
    expect(texts()).toEqual(['a \\// b']);
  });

  it('an edit is one undo step', () => {
    const source = 'A #margin-note[key][old] here.\n';
    const { doc, open, edit, text } = setup(source);
    open(0);
    type(edit(0), 'new');
    key(text, 'z', { ctrlKey: true });
    expect(doc.text).toBe(source);
  });
});

describe('resolve', () => {
  it('deletes a point note; the focus goes back to the text', () => {
    const { doc, open, button, card, text } = setup('Text#margin-note[a] more.\n');
    open(0);
    button('Resolve note').click();
    expect(doc.text).toBe('Text more.\n');
    expect(card()).toBeNull();
    expect(text.contains(document.activeElement)).toBe(true);
  });

  it('drops the call of a range note but keeps its text', () => {
    const { doc, open, button, markers } = setup('A #margin-note[key claim][note] here and #margin-note[x][y].\n');
    open(0);
    button('Resolve note').click();
    expect(doc.text).toBe('A key claim here and #margin-note[x][y].\n');
    expect(markers()).toHaveLength(1);
  });

  it('is one undo step', () => {
    const source = 'A #margin-note[key][note] here.\n';
    const { doc, open, button, text } = setup(source);
    open(0);
    button('Resolve note').click();
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
      const { doc, open, field } = setup(source);
      open(0);
      const box = field();
      box.value = 'typed';
      doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: 'XX' }], 'remote');
      expect(field()).toBe(box);
      expect(box.value).toBe('typed');
      expect(document.activeElement).toBe(box);
      key(box, 'Enter', { ctrlKey: true });
      expect(doc.text).toBe(saved);
    });
  }

  it('shows a reply from elsewhere at once', () => {
    const { doc, open, texts } = setup('A #margin-note[- *Anna* (2026-10-10): old] b.\n', { user: { name: 'Anna' } });
    open(0);
    doc.setText('A #margin-note[- *Anna* (2026-10-10): old\n- *Bob* (2026-10-11): reply] b.\n', 'remote');
    expect(texts()).toEqual(['old', 'reply']);
  });

  it('keeps a message being edited while a reply arrives, and saves into that message', () => {
    const { doc, open, edit, texts } = setup('A #margin-note[- *Anna* (2026-10-10): old] b.\n', { user: { name: 'Anna' } });
    open(0);
    const area = edit(0);
    area.value = 'typed';
    doc.setText('A #margin-note[- *Anna* (2026-10-10): old\n- *Bob* (2026-10-11): reply] b.\n', 'remote');
    expect(document.activeElement).toBe(area);
    key(area, 'Enter', { ctrlKey: true });
    expect(doc.text).toBe('A #margin-note[- *Anna* (2026-10-10): typed\n- *Bob* (2026-10-11): reply] b.\n');
    expect(texts()).toEqual(['typed', 'reply']);
  });

  it('keeps the card of a range note when its text changes', () => {
    const { doc, open, field } = setup('Text #margin-note[key][] here.\n');
    open(0);
    const box = field();
    box.value = 'typed';
    doc.change([{ from: SourceOffset.of(21), to: SourceOffset.of(21), insert: 's' }], 'remote');
    expect(field()).toBe(box);
    key(box, 'Enter', { ctrlKey: true });
    expect(doc.text).toBe(`Text #margin-note[keys][- ${signed('Anonymous', 'typed')}] here.\n`);
  });

  it('keeps the card of a note when a note is added before it', () => {
    const { doc, open, field, markers } = setup('A b#margin-note[] c.\n');
    open(0);
    const box = field();
    box.value = 'typed';
    doc.change([{ from: SourceOffset.of(1), to: SourceOffset.of(1), insert: '#margin-note[new]' }], 'remote');
    expect(markers()).toHaveLength(2);
    expect(field()).toBe(box);
    key(box, 'Enter', { ctrlKey: true });
    expect(doc.text).toBe(`A#margin-note[new] b#margin-note[- ${signed('Anonymous', 'typed')}] c.\n`);
  });

  it('closes the card whose note is gone, saving nothing; the focus goes back to the text', () => {
    const { doc, open, field, card, text } = setup('Text #margin-note[key][old] here.\n');
    open(0);
    const box = field();
    box.value = 'typed';
    doc.setText('Other text.\n', 'remote');
    expect(card()).toBeNull();
    key(box, 'Enter', { ctrlKey: true });
    expect(doc.text).toBe('Other text.\n');
    expect(text.contains(document.activeElement)).toBe(true);
  });
});

describe('editNote', () => {
  /** The messages of the card whose reply box has the focus. */
  const focusedThread = () => [...(document.activeElement?.closest('[data-testid="zwf-note-card"]')?.querySelectorAll('.zwf-comments__card-text') ?? [])]
    .map((t) => t.textContent);

  it('opens the card of the note whose source holds the offset, focused', () => {
    const source = 'Text#margin-note[a] and #margin-note[x][b].\n';
    const { view, field, texts } = setup(source);
    expect(view.editNote(source.indexOf('[a]') + 1)).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(texts()).toEqual(['a']);
    expect(view.editNote(source.indexOf('[b]') + 1)).toBe(true);
    expect(document.activeElement).toBe(field());
    expect(texts()).toEqual(['b']);
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
