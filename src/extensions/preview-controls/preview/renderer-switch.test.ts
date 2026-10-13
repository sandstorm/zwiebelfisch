// @vitest-environment jsdom
// Tests for renderer-switch.ts.
import { expect, it } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { PreviewContext, PreviewRendererInfo } from '../../../hosts/preview/preview';
import { rendererSwitch } from './renderer-switch';

it('offers every renderer, the active one pressed; a click shows one and tells; hidden with only the pages', () => {
  const changed = new EventEmitter<void>();
  let renderers: PreviewRendererInfo[] = [{ id: 'pages', label: 'Pages' }];
  const preview = {
    activeRenderer: 'pages',
    renderers: () => renderers,
    setActiveRenderer(id: string) {
      this.activeRenderer = id;
      changed.fire();
    },
    onDidChangeRenderers: changed.event,
  };
  const chosen: string[] = [];
  const item = rendererSwitch(preview, (id) => chosen.push(id))({ ownerDocument: document } as PreviewContext);
  const [group] = item.elements;
  const buttons = () => [...group.querySelectorAll('button')].map((button) => `${button.textContent}${button.getAttribute('aria-pressed') === 'true' ? '*' : ''}`);
  expect(group.hidden).toBe(true);
  renderers = [...renderers, { id: 'html', label: 'HTML' }];
  changed.fire();
  expect(group.hidden).toBe(false);
  expect(buttons()).toEqual(['Pages*', 'HTML']);
  group.querySelectorAll('button')[1].click();
  expect(preview.activeRenderer).toBe('html');
  expect(chosen).toEqual(['html']);
  expect(buttons()).toEqual(['Pages', 'HTML*']);
  item.dispose!();
  renderers = [{ id: 'pages', label: 'Pages' }];
  changed.fire();
  expect(buttons()).toEqual(['Pages', 'HTML*']);
});
