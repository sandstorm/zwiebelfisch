// Tests for zoom-buttons.ts, with the preview, the menus and the commands faked.
import { expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { PreviewMenuContext, Zoom } from '../../../hosts/preview/preview';
import { registerZoomButtons } from './zoom-buttons';

it('zooms out, in by a preset, to fit and to 100%, with the pages only', () => {
  let zoom: Zoom = 'fit';
  const items: MenuItem<PreviewMenuContext>[] = [];
  const handlers = new Map<string, () => unknown>();
  registerZoomButtons({
    preview: {
      setZoom: (next) => void (zoom = next),
      get scale() {
        return zoom === 'fit' ? 0.83 : zoom;
      },
    },
    window: { registerMenuItem: (_menuId, item) => (items.push(item as MenuItem<PreviewMenuContext>), Disposable.from()) },
    commands: { registerCommand: (id, handler) => (handlers.set(id, handler), Disposable.from()) },
  });
  expect(items.map((item) => [item.shortTitle, item.title, item.when!({ previewRenderer: 'pages' }), item.when!({ previewRenderer: 'html' })])).toEqual([
    ['−', 'Zoom out', true, false],
    ['+', 'Zoom in', true, false],
    ['Fit', 'Fit width', true, false],
    ['100%', 'Actual size', true, false],
  ]);
  const run = (title: string) => handlers.get(items.find((item) => item.title === title)!.command)!();
  run('Zoom in');
  expect(zoom).toBe(1);
  run('Zoom in');
  expect(zoom).toBe(1.25);
  run('Zoom out');
  run('Zoom out');
  expect(zoom).toBe(0.75);
  run('Fit width');
  expect(zoom).toBe('fit');
  run('Actual size');
  expect(zoom).toBe(1);
});
