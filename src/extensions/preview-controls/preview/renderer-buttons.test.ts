// Tests for renderer-buttons.ts, with the preview, the menus and the commands faked.
import { expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { PreviewMenuContext, PreviewRendererInfo } from '../../../hosts/preview/preview';
import { registerRendererButtons } from './renderer-buttons';

it('offers a button per renderer while there are several, pressed while shown; its command shows it and tells', () => {
  const changed = new EventEmitter<void>();
  let renderers: PreviewRendererInfo[] = [{ id: 'pages', label: 'Pages' }];
  const active: string[] = [];
  const items: MenuItem<PreviewMenuContext>[] = [];
  const handlers = new Map<string, () => unknown>();
  const chosen: string[] = [];
  const registration = registerRendererButtons({
    preview: { renderers: () => renderers, setActiveRenderer: (id) => void active.push(id), onDidChangeRenderers: changed.event },
    window: {
      registerMenuItem: (menuId, item) => {
        expect(menuId).toBe('preview/title');
        items.push(item as MenuItem<PreviewMenuContext>);
        return new Disposable(() => items.splice(items.indexOf(item as MenuItem<PreviewMenuContext>), 1));
      },
    },
    commands: {
      registerCommand: (id, handler) => {
        handlers.set(id, handler);
        return new Disposable(() => handlers.delete(id));
      },
    },
    onChoose: (id) => chosen.push(id),
  });
  const buttons = (previewRenderer: string) => items.map((item) => `${item.title}${item.toggled!({ previewRenderer }) ? '*' : ''}`);
  expect(items).toEqual([]);
  renderers = [...renderers, { id: 'html', label: 'HTML' }];
  changed.fire();
  expect(buttons('pages')).toEqual(['Pages*', 'HTML']);
  expect(buttons('html')).toEqual(['Pages', 'HTML*']);
  // the active one changed: the same buttons
  const before = [...items];
  changed.fire();
  expect(items).toEqual(before);
  handlers.get('previewControls.showRenderer.html')!();
  expect([active, chosen]).toEqual([['html'], ['html']]);
  registration.dispose();
  expect([items, handlers.size]).toEqual([[], 0]);
});
