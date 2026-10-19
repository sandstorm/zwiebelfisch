// @vitest-environment jsdom
// Tests for preview.ts: the PDF export options registry, the view options, the renderers, clicks, page overlays
// and boxesFor, load events and pane overlays, and restarting a crashed engine (the engine worker is replaced by a stub that answers what
// `engine.answer` returns; `engine.tell` sends its load events).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Preview,
  type HtmlBundle,
  type PageClick,
  type EngineCrash,
  type LoadEvent,
  type PdfExportOption,
  type PreviewRenderer,
  type PreviewViewOption,
} from './preview';
import { type ElementLocation, PageIndex, Pt } from '../../core/typst-engine/typst-engine';
import type { EngineRequest, WorkerLoadEvent } from './worker/protocol';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';

const engine = {
  answer: (_request: { type: string }): object | null => null,
  /** Sends a load event from the worker started last. */
  tell: (_event: unknown): void => {},
  /** The workers started, in order. */
  workers: [] as FakeWorker[],
};

/** Stands in for the engine worker (jsdom has none): answers each request with what `engine.answer` returns, until terminated. */
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    engine.workers.push(this);
    engine.tell = (event) => this.onmessage?.({ data: { type: 'progress', event } });
  }

  postMessage(request: EngineRequest | { type: 'init' }) {
    if (request.type === 'init') return;
    const body = engine.answer(request);
    if (body) queueMicrotask(() => !this.terminated && this.onmessage?.({ data: { ...body, id: request.id } }));
  }

  terminate() {
    this.terminated = true;
  }
}
vi.stubGlobal('Worker', FakeWorker);

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

describe('Preview clicks', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  it('reports the source of the clicked text and where it is drawn, marking nothing', async () => {
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
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.zwf-preview__page')).not.toBeNull());
    const before = container.querySelector('.zwf-preview__page')!.childElementCount;

    container.querySelector('.zwf-preview__page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(clicks).toEqual([{ path: '/main.typ', from: 0, to: 2, boxes }]));
    expect(container.querySelector('.zwf-preview__page')!.childElementCount).toBe(before);
  });
});

describe('Preview page overlays and boxesFor', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  function setup() {
    const page = (hash: string) => ({ hash, width: 100, height: 100, svg: '<svg></svg>' });
    const asked: SourceRange[][] = [];
    let compiles = 0;
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type === 'compile') return { type: 'compile', result: { pages: [page(String(compiles++))], diagnostics: [], missingPackages: [] } };
      if (request.type === 'boxes') {
        asked.push(request.ranges);
        return { type: 'boxes', boxes: request.ranges.map(({ from, to }) => ({ page: 0, x: from, y: 0, w: to - from, h: 10 })) };
      }
      return null;
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    const drawn = (className: string) => [...container.querySelectorAll<HTMLElement>(`.${className}`)].map((box) => [box.style.left, box.style.width]);
    return { container, asked, drawn };
  }
  const path = ProjectPath.of('/main.typ');
  const range = (from: number, to: number) => SourceRange.of({ from, to });
  const box = (x: number, w: number) => ({ page: PageIndex.of(0), x: Pt.of(x), y: Pt.of(0), w: Pt.of(w), h: Pt.of(10) });

  it('draws the boxes of each overlay as elements of its class, on the new pages after every render, until disposed', async () => {
    const { drawn } = setup();
    let renders = 0;
    preview.onDidRender(() => renders++);
    const a = preview.createPageOverlay('a');
    const b = preview.createPageOverlay('b');
    preview.update({ '/main.typ': 'Hello' }, '/main.typ');
    await vi.waitFor(() => expect(renders).toBe(1));
    a.set([box(10, 20)]);
    b.set([box(0, 5)]);
    expect(drawn('a')).toEqual([['10%', '20%']]);
    expect(drawn('b')).toEqual([['0%', '5%']]);
    preview.update({ '/main.typ': 'Hello!' }, '/main.typ');
    await vi.waitFor(() => expect(renders).toBe(2));
    expect(drawn('a')).toEqual([['10%', '20%']]);
    a.set([]);
    expect(drawn('a')).toEqual([]);
    b.dispose();
    expect(drawn('b')).toEqual([]);
    b.set([box(0, 5)]);
    preview.update({ '/main.typ': 'Hello!!' }, '/main.typ');
    await vi.waitFor(() => expect(renders).toBe(3));
    expect(drawn('b')).toEqual([]);
  });

  it('answers the boxes of ranges once their text is compiled, none while the pages show other text', async () => {
    const { asked } = setup();
    preview.update({ '/main.typ': 'Hello' }, '/main.typ');
    expect(await preview.boxesFor(path, [range(0, 2)], 'Hello world')).toEqual([]);
    expect(asked).toEqual([]);
    preview.update({ '/main.typ': 'Hello world' }, '/main.typ');
    expect(await preview.boxesFor(path, [range(0, 5), range(6, 11)], 'Hello world')).toEqual([box(0, 5), box(6, 5)]);
    expect(await preview.boxesFor(path, [], 'Hello world')).toEqual([]);
    expect(asked).toHaveLength(1);
  });
});

describe('Preview view options', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  const view = (id: string, line: string, on = false): PreviewViewOption => ({ id, label: id, default: on, apply: (entry, value) => (value ? { ...entry, prelude: [...entry.prelude, line] } : entry) });

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
    preview.registerViewOption({ id: 'a.notes', label: 'Notes', default: true, apply: (entry, on) => (on ? entry : { ...entry, prelude: [...entry.prelude, '#let hidden = true'] }) });
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
    await vi.waitFor(() => expect(container.querySelector('.zwf-preview__page')).not.toBeNull());
    expect(last().main).not.toBe('/main.typ');
    container.querySelector('.zwf-preview__page')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clicks).toEqual([]);
  });
});

describe('Preview load events and pane overlays', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  it("tells the worker's load events as they come, and a new engine starting after a crash", () => {
    engine.workers = [];
    preview = new Preview(document.createElement('div'));
    const told: LoadEvent[] = [];
    preview.onDidLoad((event) => told.push(event));
    engine.tell({ kind: 'engine', loaded: 3_100_000, total: 6_600_000 } satisfies WorkerLoadEvent);
    engine.tell({ kind: 'packages', specs: ['@preview/merman:0.4.0'] } satisfies WorkerLoadEvent);
    engine.workers[0].onerror!({ message: 'unreachable', preventDefault: () => {} });
    expect(told).toEqual([
      { kind: 'engine', loaded: 3_100_000, total: 6_600_000 },
      { kind: 'packages', specs: ['@preview/merman:0.4.0'] },
      { kind: 'starting' },
    ]);
    expect(engine.workers).toHaveLength(2);
  });

  it('is empty until the first pages are rendered', async () => {
    const container = document.createElement('div');
    preview = new Preview(container);
    expect(preview.isEmpty).toBe(true);
    const empty: boolean[] = [];
    preview.onDidRender(() => empty.push(preview.isEmpty));
    const page = { hash: 'a', width: 100, height: 100, svg: '<svg></svg>' };
    engine.answer = () => ({ type: 'compile', result: { pages: [page], diagnostics: [], missingPackages: [] } });
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(empty).toEqual([false]));
  });

  it('lays a pane overlay over the pages and a renderer, until disposed', () => {
    const container = document.createElement('div');
    preview = new Preview(container);
    const note = document.createElement('div');
    const overlay = preview.registerPaneOverlay(note);
    preview.registerRenderer({ id: 'html', label: 'HTML', output: 'html', create: () => ({ update() {}, dispose() {} }) });
    preview.setActiveRenderer('html');
    const scroller = container.querySelector('.zwf-preview__scroller')!;
    expect([...scroller.children].map((child) => child.className || 'note')).toEqual(['zwf-preview', 'zwf-preview__renderer', 'note']);
    overlay.dispose();
    expect(note.isConnected).toBe(false);
  });
});

describe('Preview after the engine crashed', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
    engine.workers = [];
  });

  const page = { hash: 'a', width: 100, height: 100, svg: '<svg></svg>' };
  const pages = { type: 'compile', result: { pages: [page], diagnostics: [], missingPackages: [] } };
  const crash = { type: 'error', message: 'capacity overflow (at ecow-0.2.6/src/vec.rs:1227)', crashed: true };

  /** A preview whose engine answers compiles with `answer(text of /main.typ, worker number)`; `crashes`: what it told. */
  function setup(answer: (text: unknown, worker: number) => object | null) {
    engine.workers = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      return request.type === 'compile' ? answer(request.files['/main.typ'], engine.workers.length) : null;
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    const crashes: EngineCrash[] = [];
    preview.onDidCrash((crash) => crashes.push(crash));
    return { container, crashes };
  }

  it('starts a new engine, sends it the files again and compiles the newest ones, and tells', async () => {
    const compiled: unknown[] = [];
    const { container, crashes } = setup((text, worker) => (compiled.push(text), worker === 1 ? crash : pages));
    preview.update({ '/main.typ': 'Hi', '/logo.png': new Uint8Array([1]) }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.zwf-preview__page')).not.toBeNull());
    expect(engine.workers.map((worker) => worker.terminated)).toEqual([true, false]);
    expect(compiled).toEqual(['Hi', 'Hi']);
    expect(crashes).toEqual([{ message: crash.message, restarting: true }]);
  });

  it('sends the new engine every file, also the bytes the crashed one had', async () => {
    const sent: unknown[] = [];
    engine.workers = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type !== 'compile') return null;
      sent.push(request.files['/logo.png']);
      return sent.length === 2 ? crash : pages;
    };
    preview = new Preview(document.createElement('div'));
    const logo = new Uint8Array([1]);
    preview.update({ '/main.typ': 'Hi', '/logo.png': logo }, '/main.typ');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    preview.update({ '/main.typ': 'Hi!', '/logo.png': logo }, '/main.typ');
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent).toEqual([logo, null, logo]);
  });

  it('answers the requests waiting for the crashed engine', async () => {
    const { container } = setup(() => pages);
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.zwf-preview__page')).not.toBeNull());
    // the engine never answers these
    const snippet = preview.snippet(ProjectPath.of('/main.typ'), SourceRange.of({ from: 0, to: 2 }), 'Hi');
    const pdf = preview.exportPdf({ main: '/main.typ', sources: {} });
    await new Promise((resolve) => setTimeout(resolve, 10));
    engine.workers[0].onerror!({ message: 'Uncaught RuntimeError: unreachable', preventDefault: () => {} });
    await expect(snippet).resolves.toBeNull();
    await expect(pdf).rejects.toThrow('Uncaught RuntimeError: unreachable');
    expect(engine.workers).toHaveLength(2);
  });

  it('stays off when the same files crash it again, until the next update', async () => {
    const { container, crashes } = setup((text) => (text === 'boom' ? crash : pages));
    preview.update({ '/main.typ': 'boom' }, '/main.typ');
    await vi.waitFor(() => expect(crashes).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(engine.workers).toHaveLength(2);
    expect(crashes.map(({ restarting }) => restarting)).toEqual([true, false]);

    preview.update({ '/main.typ': 'fine' }, '/main.typ');
    await vi.waitFor(() => expect(container.querySelector('.zwf-preview__page')).not.toBeNull());
    expect(engine.workers).toHaveLength(3);
  });
});

describe('Preview.engineMemory', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  it("is the engine's memory as each compile answers it, told when it changes", async () => {
    const answers = [10e6, 30e6, 30e6];
    engine.answer = (request) =>
      request.type === 'compile' ? { type: 'compile', result: { pages: [], diagnostics: [], missingPackages: [] }, memoryInUse: answers.shift() } : null;
    preview = new Preview(document.createElement('div'));
    const told: number[] = [];
    preview.onDidChangeEngineMemory(() => told.push(preview.engineMemory));
    expect(preview.engineMemory).toBe(0);
    for (const [index, text] of ['a', 'b', 'c'].entries()) {
      preview.update({ '/main.typ': text }, '/main.typ');
      await vi.waitFor(() => expect(answers).toHaveLength(2 - index));
    }
    await vi.waitFor(() => expect(told).toEqual([10e6, 30e6]));
    expect(preview.engineMemory).toBe(30e6);
  });
});

describe('Preview renderers', () => {
  let preview: Preview;
  afterEach(() => {
    preview.dispose();
    engine.answer = () => null;
  });

  const file = { path: 'index.html', hash: 'h', document: true, data: new TextEncoder().encode('<p>Hi</p>') };
  const elements: ElementLocation[] = [{ path: 'index.html', element: '1a' }];

  /** A renderer that logs what its view is told; the engine answers compiles of both kinds and cursor lookups. */
  function setup() {
    const log: string[] = [];
    const requests: string[] = [];
    engine.answer = (body) => {
      const request = body as EngineRequest;
      requests.push(request.type);
      if (request.type === 'compile') return { type: 'compile', result: { pages: [{ hash: 'p', width: 100, height: 100, svg: '<svg></svg>' }], diagnostics: [], missingPackages: [] } };
      const warning = { severity: 'warning', message: 'ignored in HTML', hints: [], path: '/main.typ', from: 0, to: 1 };
      if (request.type === 'html') return { type: 'html', result: { files: [file], diagnostics: [warning], missingPackages: [] } };
      if (request.type === 'elements') return { type: 'elements', elements };
      if (request.type === 'cursor') return { type: 'cursor', positions: [] };
      if (request.type === 'boxes') return { type: 'boxes', boxes: [] };
      return null;
    };
    const renderer: PreviewRenderer = {
      id: 'html',
      label: 'HTML',
      output: 'html',
      create(container) {
        container.textContent = 'html view';
        log.push('create');
        return {
          update: (output: HtmlBundle) => log.push(`update ${output.files.map((f) => f.path).join()}`),
          reveal: (found) => log.push(`reveal ${found.map((e) => `${e.path}#${e.element}`).join()}`),
          dispose: () => log.push('dispose'),
        };
      },
    };
    const container = document.createElement('div');
    preview = new Preview(container);
    return { log, requests, renderer, container };
  }

  it('lists the pages first, then the registered renderers; refuses an id twice', () => {
    const { renderer } = setup();
    expect(preview.renderers()).toEqual([{ id: 'pages', label: 'Pages' }]);
    const registered = preview.registerRenderer(renderer);
    expect(preview.renderers()).toEqual([{ id: 'pages', label: 'Pages' }, { id: 'html', label: 'HTML' }]);
    expect(() => preview.registerRenderer(renderer)).toThrow(/already registered/);
    expect(() => preview.registerRenderer({ ...renderer, id: 'pages' })).toThrow(/already registered/);
    registered.dispose();
    expect(preview.renderers()).toEqual([{ id: 'pages', label: 'Pages' }]);
  });

  it('shows the renderer asked for once it is registered, compiles HTML for it, its diagnostics the preview’s', async () => {
    const { log, requests, renderer, container } = setup();
    const changes: string[] = [];
    preview.onDidChangeRenderers(() => changes.push(preview.activeRenderer));
    const diagnostics: string[] = [];
    preview.onDidChangeDiagnostics((found) => diagnostics.push(...found.map((d) => d.message)));
    preview.setActiveRenderer('html');
    expect(preview.activeRenderer).toBe('pages');
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(requests).toEqual(['compile']));
    preview.registerRenderer(renderer);
    expect(preview.activeRenderer).toBe('html');
    expect(changes).toEqual(['html']);
    expect(container.querySelector('.zwf-preview__renderer')?.textContent).toBe('html view');
    expect(container.querySelector<HTMLElement>('[data-testid="zwf-preview"]')!.hidden).toBe(true);
    await vi.waitFor(() => expect(log).toEqual(['create', 'update index.html']));
    expect(requests).toEqual(['compile', 'html']);
    expect(diagnostics).toContain('ignored in HTML');
  });

  it('starts a renderer shown later where the cursor was revealed last', async () => {
    const { log, renderer } = setup();
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    preview.reveal(ProjectPath.of('/main.typ'), SourceRange.of({ from: 1, to: 1 }));
    preview.registerRenderer(renderer);
    preview.setActiveRenderer('html');
    await vi.waitFor(() => expect(log).toEqual(['create', 'update index.html', 'reveal index.html#1a']));
  });

  it('hands the renderer the elements at the cursor, and goes back to the pages', async () => {
    const { log, requests, renderer, container } = setup();
    preview.registerRenderer(renderer);
    preview.setActiveRenderer('html');
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(log).toContain('update index.html'));
    preview.reveal(ProjectPath.of('/main.typ'), SourceRange.of({ from: 1, to: 1 }));
    await vi.waitFor(() => expect(log).toContain('reveal index.html#1a'));
    preview.setActiveRenderer('pages');
    expect(log.at(-1)).toBe('dispose');
    expect(container.querySelector('.zwf-preview__renderer')).toBeNull();
    await vi.waitFor(() => expect(requests.at(-1)).toBe('compile'));
  });

  it('hides the toolbar items of the other renderers', () => {
    const { renderer, container } = setup();
    const item = (text: string) => () => ({ elements: [Object.assign(document.createElement('span'), { textContent: text })] });
    preview.registerToolbarItem(item('zoom'), { group: '2_view', renderer: 'pages' });
    preview.registerToolbarItem(item('follow'), { group: '1_sync' });
    const shown = () => [...container.querySelectorAll<HTMLElement>('[data-testid="zwf-preview-toolbar"] > *')].filter((e) => !e.hidden).map((e) => e.textContent);
    expect(shown()).toEqual(['follow', 'zoom']);
    preview.registerRenderer(renderer);
    preview.setActiveRenderer('html');
    expect(shown()).toEqual(['follow']);
    preview.setActiveRenderer('pages');
    expect(shown()).toEqual(['follow', 'zoom']);
  });

  it('compiles HTML with the prelude of the view options for HTML only, telling them the output; its errors there have no file', async () => {
    const { log, renderer } = setup();
    const html: { main: string; files: Record<string, unknown> }[] = [];
    const answer = engine.answer;
    const error = { severity: 'error', message: 'in the prelude', hints: [], from: 0, to: 1, path: '/.zwf-preview-view.typ' };
    engine.answer = (body) => {
      const request = body as EngineRequest;
      if (request.type !== 'html') return answer(request);
      html.push({ main: request.main, files: request.files });
      return { type: 'html', result: { files: [file], diagnostics: [{ ...error, path: request.main }], missingPackages: [] } };
    };
    const diagnostics: (string | null)[] = [];
    preview.onDidChangeDiagnostics((found) => diagnostics.push(...found.map((d) => d.path)));
    const line = (id: string, outputs?: PreviewViewOption['outputs']): PreviewViewOption => ({
      id, label: id, default: true, outputs, apply: (entry) => ({ ...entry, prelude: [...entry.prelude, `// ${id} for ${entry.output}`] }),
    });
    preview.registerViewOption(line('a.pages'));
    preview.registerViewOption(line('b.both', ['pages', 'html']));
    preview.registerRenderer(renderer);
    preview.setActiveRenderer('html');
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(log).toContain('update index.html'));
    const { main, files } = html.at(-1)!;
    expect(files['/main.typ']).toBe('Hi');
    expect(files[main]).toBe('// b.both for html\n#include "/main.typ"\n');
    expect(diagnostics.at(-1)).toBeNull();
  });

  it('compiles the pages for a snippet while another renderer is shown, once per update', async () => {
    const { log, requests, renderer } = setup();
    preview.registerRenderer(renderer);
    preview.setActiveRenderer('html');
    preview.update({ '/main.typ': 'Hi' }, '/main.typ');
    await vi.waitFor(() => expect(log).toContain('update index.html'));
    const range = SourceRange.of({ from: 0, to: 2 });
    await Promise.all([preview.snippet(ProjectPath.of('/main.typ'), range, 'Hi'), preview.snippet(ProjectPath.of('/main.typ'), range, 'Hi')]);
    expect(requests.filter((type) => type === 'compile')).toHaveLength(1);
    await preview.snippet(ProjectPath.of('/main.typ'), range, 'Hi');
    expect(requests.filter((type) => type === 'compile')).toHaveLength(1);
  });
});
