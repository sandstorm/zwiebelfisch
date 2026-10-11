// @vitest-environment jsdom
// Tests for preview.ts: the PDF export options registry and the click outline (the engine worker is replaced by a
// stub that answers what `engine.answer` returns).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview, type PageClick, type PdfExportOption } from './preview';
import type { Request } from './worker/protocol';

const engine = vi.hoisted(() => ({ answer: (_request: { type: string }): object | null => null }));

vi.mock('./worker/worker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./worker/worker')>()),
  startEngineWorker: () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage(request: Request) {
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
