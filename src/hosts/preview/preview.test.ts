// @vitest-environment jsdom
// Tests for preview.ts: the PDF export options registry, the click outline and the selection shading (the engine worker is replaced by a
// stub that answers what `engine.answer` returns).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview, type PageClick, type PdfExportOption } from './preview';
import type { EngineRequest } from './worker/protocol';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';

const engine = vi.hoisted(() => ({ answer: (_request: { type: string }): object | null => null }));

vi.mock('./worker/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./worker/worker')>()),
  startEngineWorker: () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(request: EngineRequest) {
        const body = engine.answer(request);
        if (body) queueMicrotask(() => worker.onmessage?.({ data: { ...body, id: request.id } }));
      },
      terminate() {},
    };
    return worker;
  },
}));

const option = (id: string): PdfExportOption => ({ id, label: id, default: false, apply: (entry) => entry });

describe('Preview.registerPdfExportOption', () => {
  let preview: Preview;
  afterEach(() => preview.dispose());

  it('lists the options by priority, equal priorities in registration order, until disposed', () => {
    preview = new Preview(document.createElement('div'));
    preview.registerPdfExportOption(option('a.first'));
    const late = preview.registerPdfExportOption(option('b.urgent'), { priority: 110 });
    preview.registerPdfExportOption(option('c.second'));
    expect(preview.pdfExportOptions().map((o) => o.id)).toEqual(['b.urgent', 'a.first', 'c.second']);
    late.dispose();
    expect(preview.pdfExportOptions().map((o) => o.id)).toEqual(['a.first', 'c.second']);
  });

  it('refuses a second option with the same id', () => {
    preview = new Preview(document.createElement('div'));
    preview.registerPdfExportOption(option('comments.include'));
    expect(() => preview.registerPdfExportOption(option('comments.include'))).toThrow(/already registered/);
  });
});

describe('Preview click outline', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  it('outlines the clicked text and reports its source, until clearClickHighlight', async () => {
    const page = { hash: 'a', width: 100, height: 100, svg: '<svg></svg>' };
    const boxes = [{ page: 0, x: 10, y: 10, w: 20, h: 10 }];
    engine.answer = (request) => {
      if (request.type === 'compile') return { type: 'compile', result: { pages: [page], diagnostics: [], missingPackages: [] } };
      if (request.type === 'click') return { type: 'click', jump: { kind: 'source', path: '/main.typ', offset: 1, from: 0, to: 2, boxes } };
      return null;
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    const clicks: PageClick[] = [];
    preview.onDidClickPage((click) => clicks.push(click));
    const outlines = () => container.querySelectorAll('.typst-preview__highlight').length;
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.typst-preview__page')).not.toBeNull());

    container.querySelector('.typst-preview__page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(outlines()).toBe(1));
    expect(clicks).toEqual([{ path: '/main.typ', from: 0, to: 2 }]);
    preview.clearClickHighlight();
    expect(outlines()).toBe(0);
  });
});

describe('Preview.setSelectionHighlight', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  function setup() {
    const page = (hash: string) => ({ hash, width: 100, height: 100, svg: '<svg></svg>' });
    const asked: SourceRange[][] = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type === 'compile') return { type: 'compile', result: { pages: [page(String(asked.length))], diagnostics: [], missingPackages: [] } };
      if (request.type === 'boxes') {
        asked.push(request.ranges);
        return { type: 'boxes', boxes: request.ranges.map(({ from, to }) => ({ page: 0, x: from, y: 0, w: to - from, h: 10 })) };
      }
      if (request.type === 'click') return { type: 'click', jump: { kind: 'source', path: '/main.typ', offset: 1, from: 0, to: 2, boxes: [{ page: 0, x: 0, y: 0, w: 5, h: 5 }] } };
      return null;
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    const shaded = () => [...container.querySelectorAll<HTMLElement>('.typst-preview__selection')].map((box) => [box.style.left, box.style.width]);
    const outlined = () => container.querySelectorAll('.typst-preview__highlight').length;
    return { container, asked, shaded, outlined };
  }
  const path = ProjectPath.of('/main.typ');
  const range = (from: number, to: number) => SourceRange.of({ from, to });

  it('shades the boxes of the ranges once their text is compiled, and clears them with an empty list', async () => {
    const { shaded } = setup();
    preview.update({ '/main.typ': 'Hello world' }, '/main.typ');
    preview.setSelectionHighlight(path, [range(0, 5), range(6, 11)], 'Hello world');
    await vi.waitFor(() => expect(shaded()).toEqual([['0%', '5%'], ['6%', '5%']]));
    preview.setSelectionHighlight(path, [], '');
    expect(shaded()).toEqual([]);
  });

  it('shades nothing while the pages show other text, and looks the boxes up again after every compile', async () => {
    const { shaded, asked } = setup();
    preview.update({ '/main.typ': 'Hello' }, '/main.typ');
    preview.setSelectionHighlight(path, [range(0, 2)], 'Hello world');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([]);
    expect(shaded()).toEqual([]);
    preview.update({ '/main.typ': 'Hello world' }, '/main.typ');
    await vi.waitFor(() => expect(shaded()).toEqual([['0%', '2%']]));
    expect(asked).toHaveLength(1);
    preview.update({ '/main.typ': 'Hello world' }, '/main.typ');
    await vi.waitFor(() => expect(asked).toHaveLength(2));
    expect(shaded()).toEqual([['0%', '2%']]);
  });

  it('keeps the shading apart from the outline of a click', async () => {
    const { container, shaded, outlined } = setup();
    preview.update({ '/main.typ': 'Hello world' }, '/main.typ');
    preview.setSelectionHighlight(path, [range(6, 11)], 'Hello world');
    await vi.waitFor(() => expect(shaded()).toHaveLength(1));
    container.querySelector('.typst-preview__page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(outlined()).toBe(1));
    expect(shaded()).toHaveLength(1);
    preview.clearClickHighlight();
    expect(shaded()).toHaveLength(1);
  });
});
