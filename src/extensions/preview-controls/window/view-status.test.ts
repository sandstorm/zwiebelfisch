// @vitest-environment jsdom
// Tests for view-status.ts, with the preview and the status bar faked.
import { expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { PageIndex } from '../../../core/typst-engine/typst-engine';
import type { VisiblePage, Zoom } from '../../../hosts/preview/preview';
import { registerViewStatus } from './view-status';

it('shows the zoom and the visible page in the status bar with the pages, following the view', () => {
  const view = new EventEmitter<void>();
  const renderers = new EventEmitter<void>();
  const preview = {
    activeRenderer: 'pages',
    zoom: 'fit' as Zoom,
    scale: 0.83,
    visiblePage: { index: PageIndex.of(0), count: 0 } as VisiblePage,
    onDidChangeView: view.event,
    onDidChangeRenderers: renderers.event,
  };
  const bar = document.createElement('div');
  const registration = registerViewStatus({
    preview,
    window: { ownerDocument: document, registerStatusBarItem: (element) => (bar.append(element), new Disposable(() => element.remove())) },
  });
  const shown = () => [...bar.children].map((element) => ((element as HTMLElement).hidden ? null : element.textContent));
  expect(shown()).toEqual(['Fit · 83%', '']);
  preview.zoom = 1.25;
  preview.visiblePage = { index: PageIndex.of(2), count: 12 };
  view.fire();
  expect(shown()).toEqual(['125%', '3 / 12']);
  preview.activeRenderer = 'html';
  renderers.fire();
  expect(shown()).toEqual([null, null]);
  registration.dispose();
  expect(bar.childElementCount).toBe(0);
});
