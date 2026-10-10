// @vitest-environment jsdom
// Tests for asset-view.ts.
import { describe, expect, it, vi } from 'vitest';
import { AssetView } from './asset-view';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

function setup() {
  const parent = document.createElement('div');
  const view = new AssetView(parent);
  const root = parent.querySelector<HTMLElement>('.typst-asset')!;
  return { parent, view, root };
}

describe('AssetView', () => {
  it('previews an image, without an insert button (images are dragged into the text)', () => {
    const createObjectURL = vi.fn(() => 'blob:logo');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL }); // jsdom has neither
    const { parent, root, view } = setup();
    view.show(path('/img/logo.png'), new Uint8Array(2048));
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:logo');
    expect(root.textContent).toContain('img/logo.png');
    expect(root.textContent).toContain('2.0 KB');
    expect(root.querySelector('button')).toBeNull();
    view.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo');
    expect(parent.contains(root)).toBe(false);
  });

  it('shows the text of data files and a note for other bytes', () => {
    const { root, view } = setup();
    view.show(path('/data.csv'), 'a,b');
    expect(root.querySelector('pre')?.textContent).toBe('a,b');
    expect(root.querySelector('.typst-asset__size')?.textContent).toBe('3 B');
    view.show(path('/font.otf'), new Uint8Array(3 * 1024 * 1024));
    expect(root.querySelector('.typst-asset__note')).not.toBeNull();
    expect(root.querySelector('.typst-asset__size')?.textContent).toBe('3.0 MB');
  });
});
