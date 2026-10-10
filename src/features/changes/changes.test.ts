// @vitest-environment jsdom
// Tests for changes.ts.
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { ChangeTracking, type Base } from './changes';

function setup(text: string, base: Base | null = null) {
  const toolbar = document.createElement('div');
  const doc = new TypstDocument(text);
  const view = { showChanges: vi.fn() };
  const preview = vi.fn();
  const tracking = new ChangeTracking(toolbar, { document: doc, views: [view], preview }, base);
  const button = toolbar.querySelector<HTMLButtonElement>('button')!;
  return { tracking, view, preview, button, edit: (next: string) => doc.setText(next, 'test') };
}

describe('ChangeTracking', () => {
  it('without a base, compares with the text as opened; off until switched on', () => {
    const { button, view, preview, edit } = setup('Hello world\n');
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Changes since opened');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(view.showChanges).toHaveBeenLastCalledWith(null);
    expect(preview).toHaveBeenLastCalledWith(null);
    edit('Hello big world\n');
    button.click();
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
    expect(preview).toHaveBeenLastCalledWith([{ from: 6, to: 10 }]);
  });

  it('"since opened" starts over when the text arrives later (a collaboration room synced)', () => {
    const { tracking, button, view, edit } = setup('local copy\n');
    edit('Text of the room\n');
    tracking.resetOpened();
    button.click();
    expect(view.showChanges).toHaveBeenLastCalledWith('Text of the room\n');
  });

  it('a given base is named in the button and shown at once; resetOpened leaves it alone', () => {
    const { tracking, button, view, preview } = setup('Hello big world\n');
    tracking.setBase({ text: 'Hello world\n', label: 'last saved version' });
    expect(button.textContent).toBe('Changes since last saved version');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
    expect(preview).toHaveBeenLastCalledWith([{ from: 6, to: 10 }]);
    tracking.resetOpened();
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
  });

  it('setBase(null) goes back to "since opened"', () => {
    const { tracking, button } = setup('Hello\n', { text: 'Hi\n', label: 'v1' });
    tracking.setBase(null);
    expect(button.textContent).toBe('Changes since opened');
  });

  it('updates the preview ranges after edits', () => {
    const { edit, preview } = setup('Hello world\n', { text: 'Hello world\n', label: 'v1' });
    expect(preview).toHaveBeenLastCalledWith([]);
    edit('Hello world!\n');
    expect(preview).toHaveBeenLastCalledWith([{ from: 11, to: 12 }]);
  });

  it('the toggle hides and shows the changes again', () => {
    const { button, view, preview } = setup('Hello big world\n', { text: 'Hello world\n', label: 'v1' });
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(view.showChanges).toHaveBeenLastCalledWith(null);
    expect(preview).toHaveBeenLastCalledWith(null);
    button.click();
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
  });

  it('does not compute diffs for edits while changes are hidden', () => {
    const { button, edit, preview } = setup('Hello\n', { text: 'Hello\n', label: 'v1' });
    button.click();
    preview.mockClear();
    edit('Hello there\n');
    expect(preview).not.toHaveBeenCalled();
  });
});
