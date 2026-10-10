// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Thread } from './comments';
import { CommentsPanel, type PanelActions } from './panel';

const thread = (id: string, overrides: Partial<Thread> = {}): Thread => ({
  id,
  range: { from: 0, to: 4 },
  quote: 'bold',
  resolved: false,
  comments: [{ id: `${id}-1`, author: 'Ada', time: '2026-10-10T12:00:00.000Z', text: `Comment ${id}` }],
  ...overrides,
});

function setup() {
  const actions: PanelActions = {
    select: vi.fn(),
    submitDraft: vi.fn(),
    cancelDraft: vi.fn(),
    reply: vi.fn(),
    setResolved: vi.fn(),
    remove: vi.fn(),
  };
  const panel = new CommentsPanel(document, actions);
  document.body.replaceChildren(panel.element);
  const card = (id: string) => panel.element.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!;
  return { panel, actions, card };
}

function type(box: HTMLTextAreaElement, text: string) {
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

describe('CommentsPanel', () => {
  it('shows a card per thread with quote, author, time and text', () => {
    const { panel, card } = setup();
    panel.render({ threads: [thread('a'), thread('b', { range: null, quote: 'gone' })], active: null, draft: false });
    expect(card('a').querySelector('.typst-comment__quote')?.textContent).toBe('bold');
    expect(card('a').querySelector('.typst-comment__author')?.textContent).toBe('Ada');
    expect(card('a').querySelector('time')?.getAttribute('datetime')).toBe('2026-10-10T12:00:00.000Z');
    expect(card('a').querySelector('.typst-comment__text')?.textContent).toBe('Comment a');
    expect(card('b').classList.contains('typst-comment--orphan')).toBe(true);
    expect(card('b').querySelector('.typst-comment__status')?.textContent).toBe('Text deleted');
  });

  it('selects a thread on click and offers a reply box only for the selected one', () => {
    const { panel, actions, card } = setup();
    panel.render({ threads: [thread('a'), thread('b')], active: null, draft: false });
    card('b').querySelector<HTMLElement>('.typst-comment__text')!.click();
    expect(actions.select).toHaveBeenCalledWith('b');
    panel.render({ threads: [thread('a'), thread('b')], active: 'b', draft: false });
    expect(card('a').querySelector('textarea')).toBeNull();
    const box = card('b').querySelector('textarea')!;
    type(box, 'Agreed.');
    card('b').querySelector<HTMLElement>('[data-action="submit"]')!.click();
    expect(actions.reply).toHaveBeenCalledWith('b', 'Agreed.');
  });

  it('resolves, reopens and deletes', () => {
    const { panel, actions, card } = setup();
    panel.render({ threads: [thread('a'), thread('b', { resolved: true })], active: null, draft: false });
    card('a').querySelector<HTMLElement>('[data-action="resolve"]')!.click();
    card('b').querySelector<HTMLElement>('[data-action="reopen"]')!.click();
    card('a').querySelector<HTMLElement>('[data-action="remove"]')!.click();
    expect(actions.setResolved).toHaveBeenNthCalledWith(1, 'a', true);
    expect(actions.setResolved).toHaveBeenNthCalledWith(2, 'b', false);
    expect(actions.remove).toHaveBeenCalledWith('a');
    expect(actions.select).not.toHaveBeenCalled();
  });

  it('writes a new comment: Mod-Enter submits, empty text does not, Escape cancels', () => {
    const { panel, actions } = setup();
    panel.render({ threads: [], active: null, draft: true });
    panel.focusDraft();
    const box = panel.element.querySelector('textarea')!;
    expect(document.activeElement).toBe(box);
    press(box, 'Enter', { ctrlKey: true });
    expect(actions.submitDraft).not.toHaveBeenCalled();
    type(box, '  Needs a source. ');
    press(box, 'Enter', { metaKey: true });
    expect(actions.submitDraft).toHaveBeenCalledWith('Needs a source.');
    press(box, 'Escape');
    expect(actions.cancelDraft).toHaveBeenCalled();
  });

  it('keeps typed text and focus when re-rendered', () => {
    const { panel, card } = setup();
    panel.render({ threads: [thread('a')], active: 'a', draft: false });
    const box = card('a').querySelector('textarea')!;
    box.focus();
    type(box, 'half a reply');
    panel.render({ threads: [thread('a', { quote: 'bolder' })], active: 'a', draft: false });
    const again = card('a').querySelector('textarea')!;
    expect(again).not.toBe(box);
    expect(again.value).toBe('half a reply');
    expect(document.activeElement).toBe(again);
  });
});
