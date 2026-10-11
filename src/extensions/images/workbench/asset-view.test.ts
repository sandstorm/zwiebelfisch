// @vitest-environment jsdom
// Tests for asset-view.ts: an image file opened in assetEditor.
import { describe, expect, it, vi } from 'vitest';
import { assetEditor } from './asset-view';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';

describe('assetEditor', () => {
  it('previews an image, without an insert button (images are dragged into the text), until its panel goes', () => {
    const createObjectURL = vi.fn(() => 'blob:logo');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL }); // jsdom has neither
    const element = document.createElement('div');
    const disposed = new EventEmitter<void>();
    const panel = { element, visible: true, onDidChangeViewState: new EventEmitter<void>().event, onDidDispose: disposed.event };
    assetEditor.resolveCustomEditor({ path: ProjectPath.of('/img/logo.png'), content: new Uint8Array(2048) }, panel);
    const root = element.querySelector<HTMLElement>('.typst-images__file')!;
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:logo');
    expect(root.textContent).toContain('img/logo.png');
    expect(root.textContent).toContain('2.0 KB');
    expect(root.querySelector('button')).toBeNull();
    disposed.fire();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo');
    expect(element.contains(root)).toBe(false);
  });
});
