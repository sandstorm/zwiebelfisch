// @vitest-environment jsdom
// Tests for asset-view.ts.
import { describe, expect, it, vi } from 'vitest';
import { AssetView, formatSize } from './asset-view';

function setup() {
  const parent = document.createElement('div');
  const onInsert = vi.fn();
  const view = new AssetView(parent, onInsert);
  const root = parent.querySelector<HTMLElement>('.typst-asset')!;
  return { parent, onInsert, view, root };
}

describe('AssetView', () => {
  it('previews an image and offers to insert it', () => {
    const createObjectURL = vi.fn(() => 'blob:logo');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL }); // jsdom has neither
    const { root, view, onInsert } = setup();
    expect(root.hidden).toBe(true);
    view.show('/img/logo.png', new Uint8Array(2048), '/main.typ');
    expect(root.hidden).toBe(false);
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:logo');
    expect(root.textContent).toContain('img/logo.png');
    expect(root.textContent).toContain('2.0 KB');
    root.querySelector<HTMLButtonElement>('.typst-asset__insert')!.click();
    expect(onInsert).toHaveBeenCalledWith('/img/logo.png');
    expect(root.querySelector('.typst-asset__insert')?.textContent).toBe('Insert into main.typ');
    view.hide();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo');
  });

  it('shows the text of data files and a note for other bytes', () => {
    const { root, view } = setup();
    view.show('/data.csv', 'a,b', '/main.typ');
    expect(root.querySelector('pre')?.textContent).toBe('a,b');
    expect(root.querySelector('.typst-asset__insert')).toBeNull();
    view.show('/font.otf', new Uint8Array(3), null);
    expect(root.querySelector('.typst-asset__note')).not.toBeNull();
  });
});

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect(formatSize(12)).toBe('12 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
