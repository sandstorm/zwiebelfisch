// @vitest-environment jsdom
// Tests for preview.ts: the PDF export options registry, the view options, the click outline, the selection shading and the loader (the
// engine worker is replaced by a stub that answers what `engine.answer` returns; `engine.tell` sends its load events).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview, type PageClick, type PdfExportOption, type PreviewProgress, type PreviewViewOption } from './preview';
import type { EngineRequest, LoadEvent } from './worker/protocol';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';

const engine = vi.hoisted(() => ({
  answer: (_request: { type: string }): object | null => null,
  /** Sends a load event from the worker started last. */
  tell: (_event: unknown): void => {},
}));

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
    engine.tell = (event) => worker.onmessage?.({ data: { type: 'progress', event } });
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

describe('Preview.update', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
    vi.useRealTimers();
  });

  it('starts a compile at most every 150 ms while updates come in, with the newest files', async () => {
    vi.useFakeTimers();
    const compiled: unknown[] = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type !== 'compile') return null;
      compiled.push(request.files['/main.typ']);
      return { type: 'compile', result: { pages: [], diagnostics: [], missingPackages: [] } };
    };
    preview = new Preview(document.createElement('div'));
    preview.update({ '/main.typ': 'a' }, '/main.typ');
    expect(compiled).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(50);
    preview.update({ '/main.typ': 'ab' }, '/main.typ');
    preview.update({ '/main.typ': 'abc' }, '/main.typ');
    await vi.advanceTimersByTimeAsync(80);
    expect(compiled).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(20);
    expect(compiled).toEqual(['a', 'abc']);
    await vi.advanceTimersByTimeAsync(1000);
    preview.update({ '/main.typ': 'abcd' }, '/main.typ');
    expect(compiled).toEqual(['a', 'abc', 'abcd']);
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

describe('Preview view options', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  const view = (id: string, line: string, on = false): PreviewViewOption => ({ id, label: id, default: on, apply: (entry, value) => (value ? { prelude: [...entry.prelude, line] } : entry) });

  /** A preview whose engine compiles `/main.typ`; `compiled` lists what each compile request asked for. */
  function setup(diagnostics: object[] = []) {
    const compiled: { main: string; files: Record<string, unknown> }[] = [];
    const exported: EngineRequest[] = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type === 'compile') {
        compiled.push({ main: request.main, files: request.files });
        return { type: 'compile', result: { pages: [{ hash: 'a', width: 100, height: 100, svg: '<svg></svg>' }], diagnostics, missingPackages: [] } };
      }
      if (request.type === 'pdf') {
        exported.push(request);
        return { type: 'pdf', result: { pdf: null, diagnostics: [], missingPackages: [] } };
      }
      if (request.type === 'click') return { type: 'click', jump: { kind: 'source', path: compiled.at(-1)!.main, offset: 1, from: 0, to: 2, boxes: [] } };
      return null;
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    return { container, compiled, exported, last: () => compiled.at(-1)! };
  }

  it('compiles the main file itself while no option is on', async () => {
    const { last } = setup();
    preview.registerViewOption(view('a.guides', '#set page(fill: red)'));
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(last().main).toBe('/main.typ'));
    expect(Object.keys(last().files)).toEqual(['/main.typ']);
  });

  it('compiles a file of its own with the prelude of the options that are on, by priority, then the main file included', async () => {
    const { compiled, last } = setup();
    preview.registerViewOption(view('a.first', '#set block(stroke: red)', true));
    preview.registerViewOption(view('b.urgent', '#import "x.typ": y', true), { priority: 110 });
    preview.registerViewOption(view('c.off', '#set page(fill: red)'));
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(compiled).not.toHaveLength(0));
    const { main, files } = last();
    expect(files['/main.typ']).toBe('Hi');
    expect(files[main]).toBe('#import "x.typ": y\n#set block(stroke: red)\n#include "/main.typ"\n');
    expect(preview.viewOptions().map((option) => option.id)).toEqual(['b.urgent', 'a.first', 'c.off']);
  });

  it('compiles again when values are set (also for options registered later) or an option goes', async () => {
    const { compiled, last } = setup();
    preview.setViewOptionValues({ 'a.guides': true });
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(last().main).toBe('/main.typ'));
    const guides = preview.registerViewOption(view('a.guides', '#set page(fill: red)'));
    await vi.waitFor(() => expect(last().main).not.toBe('/main.typ'));
    preview.setViewOptionValues({ 'a.guides': false });
    await vi.waitFor(() => expect(last().main).toBe('/main.typ'));
    preview.setViewOptionValues({ 'a.guides': true });
    await vi.waitFor(() => expect(last().main).not.toBe('/main.typ'));
    const count = compiled.length;
    guides.dispose();
    await vi.waitFor(() => expect(compiled.length).toBe(count + 1));
    expect(last().main).toBe('/main.typ');
  });

  it('applies an option also while it is off (one that adds Typst when off)', async () => {
    const { last } = setup();
    preview.registerViewOption({ id: 'a.notes', label: 'Notes', default: true, apply: (entry, on) => (on ? entry : { prelude: [...entry.prelude, '#let hidden = true'] }) });
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(last().main).toBe('/main.typ'));
    preview.setViewOptionValues({ 'a.notes': false });
    await vi.waitFor(() => expect(last().files[last().main]).toBe('#let hidden = true\n#include "/main.typ"\n'));
  });

  it('tells when options are registered or go', () => {
    setup();
    let changes = 0;
    preview.onDidChangeViewOptions(() => changes++);
    const guides = preview.registerViewOption(view('a.guides', ''));
    guides.dispose();
    guides.dispose();
    expect(changes).toBe(2);
  });

  it('refuses a second option with the same id', () => {
    setup();
    preview.registerViewOption(view('a.guides', ''));
    expect(() => preview.registerViewOption(view('a.guides', ''))).toThrow(/already registered/);
  });

  it('leaves PDF exports alone', async () => {
    const { exported, last } = setup();
    preview.registerViewOption(view('a.guides', '#set page(fill: red)', true));
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(last().main).not.toBe('/main.typ'));
    await preview.exportPdf({ main: '/main.typ', sources: {} });
    expect(exported).toEqual([expect.objectContaining({ type: 'pdf', main: '/main.typ', sources: {} })]);
  });

  it('reports what goes wrong in the prelude without a file', async () => {
    const { last } = setup();
    const diagnostics: (string | null)[][] = [];
    preview.onDidChangeDiagnostics((each) => diagnostics.push(each.map((d) => d.path)));
    preview.registerViewOption(view('a.guides', '#import "@preview/gone:0.1.0": x', true));
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(diagnostics).toHaveLength(1));
    const entry = last().main;
    const error = (path: string) => ({ severity: 'error', message: 'gone', hints: [], from: 0, to: 5, path });
    engine.answer = () => ({ type: 'compile', result: { pages: [], diagnostics: [error(entry), error('/main.typ')], missingPackages: [] } });
    preview.update({ '/main.typ': 'Hi!' }, '/main.typ');
    await vi.waitFor(() => expect(diagnostics.at(-1)).toEqual([null, '/main.typ']));
  });

  it('reports no click on what the prelude draws', async () => {
    const { container, last } = setup();
    const clicks: PageClick[] = [];
    preview.onDidClickPage((click) => clicks.push(click));
    preview.registerViewOption(view('a.outlines', '#set block(stroke: red)', true));
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.typst-preview__page')).not.toBeNull());
    expect(last().main).not.toBe('/main.typ');
    container.querySelector('.typst-preview__page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clicks).toEqual([]);
  });
});

describe('Preview loader', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  it('shows the engine download, then "Compiling…", and goes once the first pages are there', async () => {
    const container = document.createElement('div');
    const reported: (PreviewProgress | null)[] = [];
    preview = new Preview(container, { onDidChangeProgress: (progress) => reported.push(progress) });
    const loader = container.querySelector<HTMLElement>('[data-testid="typst-preview-loader"]')!;
    const status = loader.querySelector('[role="status"]')!;
    const bar = loader.querySelector('[role="progressbar"]')!;
    expect(loader.hidden).toBe(false);
    expect(status.textContent).toBe('Loading the Typst compiler…');

    engine.tell({ kind: 'engine', loaded: 3_100_000, total: 6_600_000 } satisfies LoadEvent);
    expect(loader.textContent).toContain('3.1 / 6.6 MB');
    expect(bar.getAttribute('aria-valuenow')).toBe('47');
    expect(bar.getAttribute('aria-valuetext')).toBe('3.1 / 6.6 MB');

    engine.tell({ kind: 'ready' } satisfies LoadEvent);
    expect(status.textContent).toBe('Compiling…');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);

    const page = { hash: 'a', width: 100, height: 100, svg: '<svg></svg>' };
    engine.answer = () => ({ type: 'compile', result: { pages: [page], diagnostics: [], missingPackages: [] } });
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.typst-preview__page')).not.toBeNull());
    expect(loader.hidden).toBe(true);
    expect(reported.map((progress) => progress?.kind ?? null)).toEqual(['engine', 'engine', 'compiling', null]);
  });

  it('says so when the engine cannot be loaded', () => {
    const container = document.createElement('div');
    preview = new Preview(container);
    engine.tell({ kind: 'failed', message: 'HTTP 404' } satisfies LoadEvent);
    const loader = container.querySelector<HTMLElement>('[data-testid="typst-preview-loader"]')!;
    expect(loader.textContent).toContain('The Typst compiler could not be loaded.');
    expect(loader.textContent).toContain('HTTP 404');
    expect(loader.querySelector<HTMLElement>('[role="progressbar"]')!.hidden).toBe(true);
  });

  it('shows a package download over the empty pane, but not once there are pages', async () => {
    const container = document.createElement('div');
    preview = new Preview(container);
    const loader = container.querySelector<HTMLElement>('[data-testid="typst-preview-loader"]')!;
    engine.tell({ kind: 'ready' } satisfies LoadEvent);
    engine.tell({ kind: 'packages', specs: ['@preview/merman:0.4.0'] } satisfies LoadEvent);
    expect(loader.textContent).toContain('Downloading @preview/merman 0.4.0…');
    const page = { hash: 'a', width: 100, height: 100, svg: '<svg></svg>' };
    engine.answer = () => ({ type: 'compile', result: { pages: [page], diagnostics: [], missingPackages: [] } });
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(loader.hidden).toBe(true));
  });
});
