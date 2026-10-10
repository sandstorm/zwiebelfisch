// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Highlight } from '../document/highlight';
import { TypstDocument } from '../document/typst-document';
import type { Marker } from '../preview/markers';
import { Comments } from './comments';
import { CommentsUI, type CommentableView } from './comments-ui';

const TEXT = 'Some bold text\n';

function fakeView(selection = { from: 5, to: 9 }) {
  const view = {
    selected: selection,
    highlights: [] as readonly Highlight[],
    selection: () => view.selected,
    reveal: vi.fn(),
    setHighlights: (_layer: string, highlights: readonly Highlight[]) => (view.highlights = highlights),
  };
  return view satisfies CommentableView;
}

function setup(json?: string) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const doc = new TypstDocument(TEXT);
  const comments = new Comments(doc, { json, user: { name: 'Ada' } });
  const view = fakeView();
  const preview = { markers: [] as readonly Marker[], setMarkers: (_: string, m: readonly Marker[]) => (preview.markers = m) };
  const ui = new CommentsUI(comments, doc, { root, views: [view], activeView: () => view, preview, path: '/main.typ' });
  root.append(ui.button, ui.panel);
  const box = () => ui.panel.querySelector('textarea')!;
  const submit = (text: string) => {
    box().value = text;
    box().dispatchEvent(new Event('input', { bubbles: true }));
    ui.panel.querySelector<HTMLElement>('[data-action="submit"]')!.click();
  };
  return { root, doc, comments, view, preview, ui, box, submit };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('CommentsUI', () => {
  it('hides the panel until there is something to show', () => {
    const { ui } = setup();
    expect(ui.panel.hidden).toBe(true);
  });

  it('comments on the selection: draft, then a highlighted, marked thread', () => {
    const { ui, view, preview, comments, box, submit } = setup();
    ui.button.click();
    expect(ui.panel.hidden).toBe(false);
    expect(document.activeElement).toBe(box());
    expect(view.highlights).toEqual([{ from: 5, to: 9, className: 'typst-comment-range typst-comment-range--draft', attributes: {} }]);
    submit('Why bold?');
    const [thread] = comments.threads();
    expect(thread.comments[0]).toMatchObject({ author: 'Ada', text: 'Why bold?' });
    expect(view.highlights).toEqual([
      { from: 5, to: 9, className: 'typst-comment-range typst-comment-range--active', attributes: { 'data-comment-id': thread.id } },
    ]);
    expect(preview.markers).toMatchObject([{ path: '/main.typ', offset: 5, attributes: { 'data-comment-id': thread.id }, title: 'Ada: Why bold?' }]);
  });

  it('does nothing without a selection', () => {
    const { ui, view } = setup();
    view.selected = { from: 3, to: 3 };
    ui.startComment();
    expect(ui.panel.hidden).toBe(true);
  });

  it('starts a comment with Mod-Alt-M and cancels it with Escape', () => {
    const { root, ui, box } = setup();
    root.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'µ', altKey: true, ctrlKey: true, bubbles: true }));
    expect(ui.panel.hidden).toBe(false);
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ui.panel.hidden).toBe(true);
  });

  it('keeps the draft range on its text while the document changes', () => {
    const { doc, ui, view, submit, comments } = setup();
    ui.startComment();
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'source');
    submit('x');
    expect(comments.threads()[0].quote).toBe('bold');
    expect(view.highlights[0]).toMatchObject({ from: 13, to: 17 });
  });

  it('updates highlights and markers after edits, once per task', async () => {
    const { doc, ui, view, preview, submit } = setup();
    ui.startComment();
    submit('x');
    const spy = vi.spyOn(view, 'setHighlights');
    doc.change([{ from: 0, to: 0, insert: 'A' }], 'source');
    doc.change([{ from: 0, to: 0, insert: 'B' }], 'source');
    expect(spy).not.toHaveBeenCalled();
    await tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(view.highlights[0]).toMatchObject({ from: 7, to: 11 });
    expect(preview.markers[0].offset).toBe(7);
  });

  it('selects a thread from a highlight click, and reveals its text from a card or marker click', () => {
    const { root, ui, view, submit, comments } = setup();
    ui.startComment();
    submit('first');
    view.selected = { from: 10, to: 14 };
    ui.startComment();
    submit('second');
    const [first, second] = comments.threads();
    const highlight = document.createElement('span');
    highlight.dataset.commentId = first.id;
    root.append(highlight);
    highlight.click();
    expect(ui.panel.querySelector('.typst-comment--active')?.getAttribute('data-thread-id')).toBe(first.id);
    expect(view.reveal).not.toHaveBeenCalled();

    ui.panel.querySelector<HTMLElement>(`[data-thread-id="${second.id}"] .typst-comment__text`)!.click();
    expect(view.reveal).toHaveBeenLastCalledWith(10, 14);

    const marker = document.createElement('div');
    marker.dataset.previewMarker = '';
    marker.dataset.commentId = first.id;
    root.append(marker);
    marker.click();
    expect(view.reveal).toHaveBeenLastCalledWith(5, 9);
  });

  it('shows resolved threads in the panel only', () => {
    const { ui, view, preview, submit, comments } = setup();
    ui.startComment();
    submit('x');
    comments.setResolved(comments.threads()[0].id, true);
    ui.startComment();
    ui.panel.querySelector<HTMLElement>('[data-action="cancel"]')!.click();
    expect(view.highlights).toEqual([]);
    expect(preview.markers).toEqual([]);
    expect(ui.panel.querySelector('.typst-comment--resolved')).not.toBeNull();
  });

  it('removes its highlights, markers and elements on destroy', () => {
    const { ui, view, preview, submit } = setup();
    ui.startComment();
    submit('x');
    ui.destroy();
    expect(view.highlights).toEqual([]);
    expect(preview.markers).toEqual([]);
    expect(ui.panel.isConnected).toBe(false);
  });
});
