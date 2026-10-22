// @vitest-environment jsdom
// Tests for image-editor.ts: an image file opened in imageEditor.
import { describe, expect, it, vi } from 'vitest';
import { imageEditor } from './image-editor';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceRange } from '../../../core/typst-document/typst-document';

describe('imageEditor', () => {
  it('previews an image, without an insert button (images are dragged into the text), until its panel goes', () => {
    const createObjectURL = vi.fn(() => 'blob:logo');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL }); // jsdom has neither
    const element = document.createElement('div');
    const disposed = new EventEmitter<void>();
    const panel = { element, visible: true, onDidChangeViewState: new EventEmitter<void>().event, onDidDispose: disposed.event, onDidRequestReveal: new EventEmitter<SourceRange>().event };
    imageEditor.resolveEditor({ path: ProjectPath.of('/img/logo.png'), content: new Uint8Array(2048) }, panel);
    const root = element.querySelector<HTMLElement>('.zwf-images__file')!;
    expect(root.querySelector('img')?.getAttribute('src')).toBe('blob:logo');
    expect(root.textContent).toContain('img/logo.png');
    expect(root.textContent).toContain('2.0 KB');
    expect(root.querySelector('button')).toBeNull();
    disposed.fire();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:logo');
    expect(element.contains(root)).toBe(false);
  });
});
