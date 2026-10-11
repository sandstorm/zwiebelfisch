// @vitest-environment jsdom
// Measures typing in the Visual editor of the whole widget (`mise run perf:typing`): per keystroke, the time the
// keystroke's own handling blocks (sync) and the main thread's work in all (sync, timers, compile answers), with a CPU
// profile summed up by module and function. The engine runs in-process (in-process-worker.ts) and is counted apart.
// See docs/30_architecture/11_development.typ, "Performance".
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { expect, it } from 'vitest';
import { createTypstEditor } from '../../src/typst-editor/typst-editor';
import type { ProjectFiles } from '../../src/core/project/project';
import { Profiler, summarize } from './cpu-profile';
import { InProcessWorker } from './in-process-worker';
import { LayoutReads } from './layout-reads';

// the preview's engine worker (jsdom has no Worker)
globalThis.Worker = InProcessWorker as unknown as typeof Worker;

/** The repository (mise runs tasks there). */
const root = `${process.cwd()}/`;
const out = join(root, '.cache/perf');
/** The text typed, one character per keystroke. */
const TYPED = ' and quickly typed words';
/** Typed after `TYPED`, counting the layout reads. */
const COUNTED = ' again';
/** The pause between two keystrokes (a fast typist): timers and compile answers run in it. */
const KEYSTROKE_INTERVAL_MS = 80;

interface Scenario {
  name: string;
  /** The example's folder (its files become the project's). */
  folder: string;
  /** The file typed in, and the text the cursor goes after. */
  path: string;
  after: string;
  /** The node the cursor must be in. */
  inside: 'paragraph' | 'listItem' | 'tableCell';
}

const ADVANCED = 'demo/examples/advanced';
const DOCS = 'docs';
const FEATURES = '/10_guide/02_features.typ';
const scenarios: Scenario[] = [
  { name: 'advanced, paragraph', folder: ADVANCED, path: '/chapters/introduction.typ', after: 'while they type', inside: 'paragraph' },
  { name: 'advanced, list item', folder: ADVANCED, path: '/chapters/introduction.typ', after: 'length of a document', inside: 'listItem' },
  { name: 'advanced, table cell', folder: ADVANCED, path: '/chapters/results.typ', after: '4.5×', inside: 'tableCell' },
  { name: 'docs, paragraph', folder: DOCS, path: FEATURES, after: 'One panel per side shows', inside: 'paragraph' },
  { name: 'docs, list item', folder: DOCS, path: FEATURES, after: 'line numbers, search', inside: 'listItem' },
  { name: 'docs, table cell', folder: DOCS, path: FEATURES, after: 'jumps to the heading', inside: 'tableCell' },
];
const only = process.env.TYPST_PERF_SCENARIO;
const layoutReads = new LayoutReads(root);

/**
 * The IntersectionObserver jsdom lacks, which says what is near the view (without one, every page would get its SVG
 * and every raw box would be drawn after every compile): the preview's pages `show` names, and the Visual editor's
 * blocks around the cursor's. Reported in a later microtask, as a browser reports them.
 */
class NearView {
  private static readonly observers = new Set<NearView>();
  private static near: (element: HTMLElement) => boolean = () => false;
  private readonly elements = new Set<HTMLElement>();

  constructor(private readonly callback: (changes: Partial<IntersectionObserverEntry>[]) => void) {
    NearView.observers.add(this);
  }

  /** Makes pages `pages` (0-based) and the top-level blocks `blocks` (indexes) of the Visual editor `text` the ones near the view. */
  static show(pages: readonly number[], text: HTMLElement, blocks: { from: number; to: number }): void {
    NearView.near = (element) => {
      if (element.dataset.number) return pages.includes(Number(element.dataset.number) - 1);
      const block = [...text.children].findIndex((child) => child.contains(element));
      return block >= blocks.from && block <= blocks.to;
    };
    for (const observer of NearView.observers) observer.report([...observer.elements]);
  }

  observe(element: HTMLElement): void {
    this.elements.add(element);
    this.report([element]);
  }

  unobserve(element: HTMLElement): void {
    this.elements.delete(element);
  }

  disconnect(): void {
    this.elements.clear();
    NearView.observers.delete(this);
  }

  private report(elements: HTMLElement[]): void {
    queueMicrotask(() => this.callback(elements.map((target) => ({ target, isIntersecting: NearView.near(target) }))));
  }
}
globalThis.IntersectionObserver = NearView as unknown as typeof IntersectionObserver;
/** How many top-level blocks before and after the cursor's are near the view: a screen of text, and one above and below. */
const NEAR_BLOCKS = 30;

it.each(scenarios.filter((scenario) => !only || scenario.name.includes(only)))('typing: $name', async (scenario) => {
  const host = document.body.appendChild(document.createElement('div'));
  const widget = createTypstEditor(host, { files: folderFiles(scenario.folder) });
  await settled();
  widget.open(scenario.path);
  const tiptap = visualEditor(host);
  const block = placeCursor(tiptap, scenario);
  // the preview shows the page typed in (as "Follow cursor" does) and the pages around it
  const page = await InProcessWorker.pageOf(scenario.path, widget.files[scenario.path]!.toString().indexOf(scenario.after));
  NearView.show([page - 1, page, page + 1], tiptap.view.dom, { from: block - NEAR_BLOCKS, to: block + NEAR_BLOCKS });
  await typeText(tiptap, ' warm', 20); // warms the code paths up (JIT), then the measured run
  await settled();

  const profiler = new Profiler();
  const engineBefore = InProcessWorker.time;
  const compilesBefore = InProcessWorker.compiles;
  await profiler.start();
  const started = performance.now();
  const sync = await typeText(tiptap, TYPED, KEYSTROKE_INTERVAL_MS);
  await settled();
  const wall = performance.now() - started;
  const profile = await profiler.stop();
  const engine = InProcessWorker.time - engineBefore;
  const compiles = InProcessWorker.compiles - compilesBefore;
  const summary = summarize(profile, root, 'keystroke');
  // apart from the profile: finding the caller of each read takes time
  layoutReads.start();
  await typeText(tiptap, COUNTED, KEYSTROKE_INTERVAL_MS);
  await settled();
  const reads = layoutReads.stop();
  expect(widget.files[scenario.path]).toContain(TYPED + COUNTED);
  widget.dispose();
  host.remove();

  const keys = TYPED.length;
  const result = {
    scenario: scenario.name,
    keystrokes: keys,
    syncMs: { median: quantile(sync, 0.5), p95: quantile(sync, 0.95), max: Math.max(...sync) },
    mainThreadMsPerKey: summary.mainThread / keys,
    engineMsPerKey: engine / keys,
    compiles,
    wallMs: wall,
    byModuleMsPerKey: perKey(summary.byModule.slice(0, 25), keys),
    byFunctionMsPerKey: perKey(summary.byFunction.slice(0, 50), keys),
    keystrokeByFunctionMsPerKey: perKey(summary.keystroke.byFunction.slice(0, 50), keys),
    layoutReadsPerKey: perKey(reads.slice(0, 20), COUNTED.length),
  };
  mkdirSync(out, { recursive: true });
  const slug = scenario.name.replace(/\W+/g, '-');
  writeFileSync(join(out, `typing-${slug}.cpuprofile`), JSON.stringify(profile));
  writeFileSync(join(out, `typing-${slug}.json`), JSON.stringify(result, null, 2));
  process.stdout.write(`${report(result)}\n`);
}, 600_000);

/** The files of an example folder as `createTypstEditor` takes them: `.typ` as text, the rest as bytes. */
function folderFiles(folder: string): ProjectFiles {
  const files: ProjectFiles = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[`/${relative(join(root, folder), path)}`] = name.endsWith('.typ') ? readFileSync(path, 'utf8') : new Uint8Array(readFileSync(path));
    }
  };
  walk(join(root, folder));
  return files;
}

/** Waits until timers, compiles and their answers have run (nothing new for a while). */
async function settled(): Promise<void> {
  for (let quiet = 0, last = -1; quiet < 3; ) {
    await sleep(100);
    quiet = InProcessWorker.waiting === 0 && InProcessWorker.time === last ? quiet + 1 : 0;
    last = InProcessWorker.time;
  }
}

/** The Tiptap editor of the shown Visual editor. */
function visualEditor(host: HTMLElement): Editor {
  const shown = [...host.querySelectorAll<HTMLElement>('.typst-visual')].find((element) => element.closest('[hidden]') === null);
  const editor = (shown as (HTMLElement & { editor?: Editor }) | undefined)?.editor;
  if (!editor) throw new Error('no Visual editor shown');
  return editor;
}

/** Puts the cursor right after `scenario.after`, checking it is in the node the scenario types in; the index of its top-level block. */
function placeCursor(editor: Editor, scenario: Scenario): number {
  const { doc } = editor.state;
  let at = -1;
  doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(scenario.after)) at = pos + node.text!.indexOf(scenario.after) + scenario.after.length;
    return at < 0;
  });
  if (at < 0) throw new Error(`"${scenario.after}" not in the Visual editor of ${scenario.path}`);
  const $at = doc.resolve(at);
  const path = Array.from({ length: $at.depth + 1 }, (_, depth) => $at.node(depth).type.name);
  if (!path.includes(scenario.inside)) throw new Error(`"${scenario.after}" is in ${path.join(' > ')}, not in a ${scenario.inside}`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, at)));
  return $at.index(0);
}

/** Types `text` one character per keystroke, `interval` ms apart; the synchronous time of each keystroke in ms. */
async function typeText(editor: Editor, text: string, interval: number): Promise<number[]> {
  const times: number[] = [];
  for (const char of text) {
    const started = performance.now();
    keystroke(editor, char);
    times.push(performance.now() - started);
    await sleep(interval);
  }
  return times;
}

/** Types `char` as the browser's text input does (input rules and suggestions see it). The profile's sync part. */
function keystroke(editor: Editor, char: string): void {
  const { view } = editor;
  const { from, to } = view.state.selection;
  const insert = () => view.state.tr.insertText(char, from, to);
  if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, char, insert))) view.dispatch(insert());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function perKey(entries: [string, number][], keys: number): [string, number][] {
  return entries.map(([name, ms]) => [name, round(ms / keys)]);
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}

function report(result: { scenario: string; compiles: number; syncMs: Record<string, number>; mainThreadMsPerKey: number; engineMsPerKey: number; byModuleMsPerKey: [string, number][]; byFunctionMsPerKey: [string, number][]; keystrokeByFunctionMsPerKey: [string, number][]; layoutReadsPerKey: [string, number][] }): string {
  const lines = [
    `── ${result.scenario}`,
    `sync per keystroke: median ${round(result.syncMs.median)} ms, p95 ${round(result.syncMs.p95)} ms, max ${round(result.syncMs.max)} ms`,
    `main thread per keystroke: ${round(result.mainThreadMsPerKey)} ms (engine, in the worker in a browser: ${round(result.engineMsPerKey)} ms; ${result.compiles} compiles)`,
    'by module (ms per keystroke):',
    ...result.byModuleMsPerKey.slice(0, 15).map(([name, ms]) => `  ${ms.toFixed(2).padStart(7)}  ${name}`),
    'by function, inclusive (ms per keystroke):',
    ...result.byFunctionMsPerKey.slice(0, 30).map(([name, ms]) => `  ${ms.toFixed(2).padStart(7)}  ${name}`),
    'the keystroke itself, by function, inclusive (ms per keystroke):',
    ...result.keystrokeByFunctionMsPerKey.slice(0, 30).map(([name, ms]) => `  ${ms.toFixed(2).padStart(7)}  ${name}`),
    'layout reads (forced layouts in a browser after a DOM change), per keystroke:',
    ...result.layoutReadsPerKey.map(([name, count]) => `  ${count.toFixed(2).padStart(7)}  ${name}`),
  ];
  return lines.join('\n');
}
