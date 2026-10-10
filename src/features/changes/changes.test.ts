// @vitest-environment jsdom
// Tests for changes.ts.
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { ChangeTracking } from './changes';

function setup(text: string, base: string | null = null) {
  const toolbar = document.createElement('div');
  const doc = new TypstDocument(text);
  const view = { showChanges: vi.fn() };
  const preview = vi.fn();
  const tracking = new ChangeTracking(toolbar, { document: doc, views: [view], preview }, base);
  const button = toolbar.querySelector<HTMLButtonElement>('button')!;
  return { tracking, view, preview, button, edit: (next: string) => doc.setText(next, 'test') };
}

describe('ChangeTracking', () => {
  it('hides the toggle and shows nothing without a base', () => {
    const { button, view, preview } = setup('Hello\n');
    expect(button.hidden).toBe(true);
    expect(view.showChanges).toHaveBeenLastCalledWith(null);
    expect(preview).toHaveBeenLastCalledWith(null);
  });

  it('shows changes in every view once a base is set', () => {
    const { tracking, button, view, preview } = setup('Hello big world\n');
    tracking.setBase('Hello world\n');
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
    expect(preview).toHaveBeenLastCalledWith([{ from: 6, to: 10 }]);
  });

  it('updates the preview ranges after edits', () => {
    const { edit, preview } = setup('Hello world\n', 'Hello world\n');
    expect(preview).toHaveBeenLastCalledWith([]);
    edit('Hello world!\n');
    expect(preview).toHaveBeenLastCalledWith([{ from: 11, to: 12 }]);
  });

  it('the toggle hides and shows the changes again', () => {
    const { button, view, preview } = setup('Hello big world\n', 'Hello world\n');
    button.click();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(view.showChanges).toHaveBeenLastCalledWith(null);
    expect(preview).toHaveBeenLastCalledWith(null);
    button.click();
    expect(view.showChanges).toHaveBeenLastCalledWith('Hello world\n');
  });

  it('does not compute diffs for edits while changes are hidden', () => {
    const { button, edit, preview } = setup('Hello\n', 'Hello\n');
    button.click();
    preview.mockClear();
    edit('Hello there\n');
    expect(preview).not.toHaveBeenCalled();
  });
});
