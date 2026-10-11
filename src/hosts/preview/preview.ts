// Preview: the live preview of a Typst project, compiled in a worker, with hit-testing. Entry of hosts/preview/.
// See docs/architecture/preview.typ.
// Why a host: the preview keeps the mechanism — the engine worker and its protocol, coalesced compiles, the
// lazily rendered page list, hit-testing (`onDidClickPage`), scrolling and reveal. What sits on top of it is
// contributed: toolbar items (zoom, "Follow cursor", page number, "Download PDF"), the options a PDF export offers,
// and the policy of when to reveal what (the preview-sync extension follows the cursor and
// jumps to the source of a click). So a feature adds to the preview without the preview knowing it.
import { Disposable } from '../../core/disposable/disposable';
import { type Event, EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Diagnostic, Page, PdfEntry, PdfResult, Position } from '../../core/typst-engine/typst-engine';
import { isInside, mostVisible } from './pages/geometry';
import { overlay, OverlayLayer } from './pages/overlays';
import { PageList } from './pages/page-list';
import { snippet } from './pages/snippet';
import { DEFAULT_FONT_URLS, ENGINE_WASM_URL } from '../../core/engine-assets/engine-assets';
import type { FileContent } from '../../core/project/project';
import { FileSender } from './worker/project-files';
import type { Init, Request, Response } from './worker/protocol';
import { startEngineWorker } from './worker/worker';
import { LatestOnly } from './latest-only';

/**
 * The preview as extensions see it (`ExtensionContext.preview`): its contribution points, and what its engine
 * answers about the project it compiles.
 */
export interface PreviewContributions {
  /**
   * Adds a control to the toolbar until disposed, at `placement`: VS Code's menu `group` + `order` (groups by name,
   * `navigation` first; the built-ins: `1_sync` "Follow cursor", `2_view` zoom and page number, `3_export` "Download
   * PDF"), never by registration order alone.
   */
  registerToolbarItem(item: PreviewToolbarItem, placement: ToolbarPlacement): Disposable;
  /**
   * Offers a choice for PDF exports (a checkbox), until disposed. An export applies every option, by `priority`
   * (default 100, higher first; equal: registration order), each to what the ones before it made. Throws when an
   * option with the same `id` is registered.
   */
  registerPdfExportOption(option: PdfExportOption, options?: { priority?: number }): Disposable;
  /** The registered PDF export options, in the order an export applies them. */
  pdfExportOptions(): readonly PdfExportOption[];
  /**
   * The errors and warnings of each compilation of the newest files given to the preview (results of outdated
   * files are not reported, so the offsets match the text last given).
   */
  readonly onDidChangeDiagnostics: Event<readonly Diagnostic[]>;
  /** After every successful compilation (snippets may have changed). */
  readonly onDidRender: Event<void>;
  /**
   * Scrolls the preview to where the source range `from`..`to` of `path` is drawn (its start), only if that is
   * off-screen; nothing is marked there. Cheap to call on every cursor move: calls are throttled and only the
   * newest is looked up.
   */
  reveal(path: string, from: number, to: number): void;
  /** Someone clicked something in the preview that has a source location (outlined in the preview until the next click or compile). */
  readonly onDidClickPage: Event<PageClick>;
  /**
   * How the source range `from`..`to` of `path`, which holds `text`, is drawn: its page cut down to it. Null when it
   * draws nothing or `text` is not what was compiled last.
   */
  snippet(path: string, from: number, to: number, text: string): Promise<Snippet | null>;
  /** A PDF of `entry.main` from the files last compiled, `entry.sources` replacing or adding text files for it. */
  exportPdf(entry: PdfEntry): Promise<PdfResult>;
}

/** A control in the preview's toolbar: made once, for the preview it is registered with. */
export type PreviewToolbarItem = (preview: PreviewContext) => ToolbarItemView;

/**
 * Where a toolbar item goes, as in VS Code's menus: the groups in the order of their names (the group `navigation`
 * first), so groups are named like `1_sync`, `2_view`; within a group by `order` (default 0), then registration order.
 */
export interface ToolbarPlacement {
  readonly group: string;
  readonly order?: number;
}

/** A toolbar item as made for one preview. */
export interface ToolbarItemView {
  /** Its elements, placed in the toolbar in this order, where its `ToolbarPlacement` puts it. */
  readonly elements: readonly HTMLElement[];
  /** Called (at most once per frame) after the view changed: scrolled, resized, zoomed, new pages. */
  update?(): void;
  /** Called when the item is unregistered or the preview disposed; the toolbar removes `elements`. */
  dispose?(): void;
}

/** What a toolbar item may read and change of the preview it is in. */
export interface PreviewContext {
  /** The DOM document the preview lives in (to make elements). */
  readonly ownerDocument: Document;
  zoom(): Zoom;
  /** Zooms, keeping the part of the document shown (relatively) where it was. */
  setZoom(zoom: Zoom): void;
  /** The scale of the first page (1 = 100 %), also when fitting the width. */
  scale(): number;
  /** The page covering most of the viewport (0-based) and the number of pages. */
  visiblePage(): { index: number; count: number };
}

/** A click in the preview on something with a source location: the source range of what was clicked (e.g. a text run). */
export interface PageClick {
  /** The file, as the engine names it (a project path, or a package file). */
  readonly path: string;
  readonly from: number;
  readonly to: number;
}

/**
 * A choice offered when exporting a PDF (a checkbox next to "Download"; `exportPdf(options)` for hosts), e.g.
 * whether the PDF includes the comments. Each option changes what is compiled, never the documents. Options are
 * checkboxes for now; a later `choices?: { value, label }[]` would make `default` and `value` one of them.
 */
export interface PdfExportOption {
  /** `<extension>.<name>`, e.g. `comments.include`: the key in `exportPdf(options)` and in what is remembered. */
  readonly id: string;
  /** The checkbox's label ("Include comments"). */
  readonly label: string;
  /** A longer explanation, shown as the checkbox's tooltip. */
  readonly description?: string;
  /** Its value until someone chooses otherwise. */
  readonly default: boolean;
  /**
   * What to compile with this option set to `value`, from what the options before it made (see
   * `PreviewContributions.registerPdfExportOption` for the order). Called for every option, also when it is off.
   */
  apply(entry: PdfEntry, value: boolean): PdfEntry;
}

/** Preview zoom: fit the pane width, or a fixed scale where 1 = 100 % (1 pt = 1/72 in). */
export type Zoom = 'fit' | number;

/** A cut-out of a compiled page: standalone SVG markup and its size in points. */
export interface Snippet {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  /** Height of its tallest box (pt): one line of its biggest text, what an inline view scales by. */
  readonly textHeight: number;
  /** Space (pt) kept around what is drawn (less where the page ends). */
  readonly padding: number;
}

type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;
type Compile = { files: Record<string, FileContent>; main: string };
type Reveal = { path: string; from: number };

/** Minimum time between two cursor → preview lookups while the cursor moves. */
const REVEAL_INTERVAL_MS = 80;

/**
 * The live preview: compiles Typst in a worker and shows the pages as SVG,
 * under a toolbar of contributed items.
 *
 * Hides the worker, request coalescing (only the newest pending update or
 * reveal is processed), lazy and incremental page rendering, and the px ↔ pt
 * mapping for click-to-source and source-to-preview reveal.
 */
export class Preview implements PreviewContributions {
  private readonly worker = startEngineWorker();
  private readonly pending = new Map<number, (response: Response) => void>();
  private readonly pane: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly list: PageList;
  private readonly compiles: LatestOnly<Compile>;
  private readonly reveals: LatestOnly<Reveal>;
  private readonly resizeObserver: ResizeObserver | null;
  /** What toolbar items see of the preview. */
  private readonly context: PreviewContext;
  /** The toolbar's items in toolbar order. */
  private readonly items: { view: ToolbarItemView; group: string; order: number }[] = [];
  /** The PDF export options, with their priority, in registration order. */
  private readonly exportOptions: { option: PdfExportOption; priority: number }[] = [];
  /** Outlines the clicked text, until the next click or successful compile. */
  private readonly clickHighlight: OverlayLayer;
  private zoom: Zoom = 'fit';
  private nextId = 0;
  private readonly sender = new FileSender();
  private frame = 0;
  /** The files and pages of the last successful compilation. */
  private compiled: { files: Record<string, FileContent>; pages: Page[] } = { files: {}, pages: [] };
  private readonly rendered = new EventEmitter<void>();
  private readonly diagnosed = new EventEmitter<readonly Diagnostic[]>();
  private readonly clicked = new EventEmitter<PageClick>();
  readonly onDidRender = this.rendered.event;
  readonly onDidChangeDiagnostics = this.diagnosed.event;
  readonly onDidClickPage = this.clicked.event;

  constructor(container: HTMLElement) {
    const doc = container.ownerDocument;
    this.pane = div(doc, 'typst-preview-pane');
    this.toolbar = div(doc, 'typst-preview__toolbar');
    this.toolbar.dataset.testid = 'typst-preview-toolbar';
    this.scroller = div(doc, 'typst-preview__scroller');
    this.pages = div(doc, 'typst-preview');
    this.pages.dataset.testid = 'typst-preview';
    this.list = new PageList(this.pages, { root: this.scroller });
    this.clickHighlight = new OverlayLayer(this.list, 'typst-preview__highlight');
    this.context = this.itemContext(doc);
    this.scroller.append(this.pages);
    this.pane.append(this.toolbar, this.scroller);
    container.append(this.pane);

    this.pages.addEventListener('click', (event) => void this.handleClick(event));
    this.scroller.addEventListener('scroll', () => this.scheduleStatus(), { passive: true });
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.scheduleStatus());
    this.resizeObserver?.observe(this.scroller);
    this.compiles = new LatestOnly((compile, superseded) => this.compile(compile, superseded));
    this.reveals = new LatestOnly((reveal, superseded) => this.lookUp(reveal, superseded), {
      interval: REVEAL_INTERVAL_MS,
    });

    this.worker.postMessage({ type: 'init', wasm: ENGINE_WASM_URL, fonts: DEFAULT_FONT_URLS } satisfies Init);
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      this.pending.get(event.data.id)?.(event.data);
      this.pending.delete(event.data.id);
    };
  }

  /**
   * Shows the given project files, compiling `main`. Files map absolute
   * paths (`/main.typ`, `/img/logo.png`) to Typst source text or to bytes.
   * `@preview` packages the document imports are downloaded on first use.
   * Cheap to call on every keystroke: updates arriving while a compilation
   * runs are collapsed into one, and bytes that are the same `Uint8Array` as
   * last time are not sent to the worker again.
   */
  update(files: Record<string, FileContent>, main: string): void {
    this.compiles.push({ files, main });
  }

  reveal(path: string, from: number, _to: number): void {
    this.reveals.push({ path, from });
  }

  /**
   * How the source range `from`..`to` of `path` looks in the document: its
   * page cut down to where that range draws text, shapes or images (first page
   * only). Null when it draws nothing, or when `text` is not what that range
   * held at the last successful compilation (it was edited, or the document
   * has errors). Waits for running compilations, so it answers for the newest
   * text passed to `update()`.
   */
  async snippet(path: string, from: number, to: number, text: string): Promise<Snippet | null> {
    await this.compiles.idle();
    const { files, pages } = this.compiled;
    const compiled = files[path];
    if (typeof compiled !== 'string' || compiled.slice(from, to) !== text) return null;
    const response = await this.request({ type: 'boxes', path, ranges: [{ from, to }] });
    return response.type === 'boxes' ? snippet(pages, response.boxes) : null;
  }

  /**
   * A PDF of `entry.main` (null with the errors when it does not compile), from the
   * files last passed to `update()`, with `entry.sources` replacing or adding text
   * files for this export only. Waits for running compilations; the preview
   * itself does not change.
   */
  async exportPdf(entry: PdfEntry): Promise<PdfResult> {
    await this.compiles.idle();
    const response = await this.request({ type: 'pdf', main: entry.main, sources: { ...entry.sources } });
    if (response.type === 'pdf') return response.result;
    throw new Error(response.type === 'error' ? response.message : 'unexpected answer from the engine');
  }

  registerToolbarItem(item: PreviewToolbarItem, placement: ToolbarPlacement): Disposable {
    const view = item(this.context);
    const entry = { view, group: placement.group, order: placement.order ?? 0 };
    // the sort is stable: equal places stay in registration order
    this.items.push(entry);
    this.items.sort(byPlacement);
    this.toolbar.append(...this.items.flatMap((each) => each.view.elements));
    this.scheduleStatus();
    return new Disposable(() => this.removeItem(view));
  }

  registerPdfExportOption(option: PdfExportOption, options: { priority?: number } = {}): Disposable {
    if (this.exportOptions.some((entry) => entry.option.id === option.id)) throw new Error(`PDF export option '${option.id}' is already registered`);
    const entry = { option, priority: options.priority ?? 100 };
    this.exportOptions.push(entry);
    return new Disposable(() => {
      const index = this.exportOptions.indexOf(entry);
      if (index >= 0) this.exportOptions.splice(index, 1);
    });
  }

  pdfExportOptions(): readonly PdfExportOption[] {
    // the sort is stable: equal priorities stay in registration order
    return [...this.exportOptions].sort((a, b) => b.priority - a.priority).map((entry) => entry.option);
  }

  dispose(): void {
    this.rendered.dispose();
    this.diagnosed.dispose();
    this.clicked.dispose();
    for (const { view } of [...this.items]) this.removeItem(view);
    this.worker.terminate();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.list.dispose();
    this.pane.remove();
  }

  private itemContext(doc: Document): PreviewContext {
    return {
      ownerDocument: doc,
      zoom: () => this.zoom,
      setZoom: (zoom) => this.setZoom(zoom),
      scale: () => this.list.scale(),
      visiblePage: () => this.visiblePage(),
    };
  }

  private removeItem(item: ToolbarItemView): void {
    const index = this.items.findIndex((entry) => entry.view === item);
    if (index < 0) return;
    this.items.splice(index, 1);
    for (const element of item.elements) element.remove();
    item.dispose?.();
  }

  private async compile({ files, main }: Compile, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'compile', files: this.sender.encode(files), main });
    if (response.type !== 'compile') return;
    // Keep showing the last good pages while the document has errors, dimmed as stale.
    const failed = response.result.pages.length === 0;
    if (!failed) {
      this.clickHighlight.set([]);
      this.list.render(response.result.pages);
      this.clickHighlight.redraw();
      this.scheduleStatus();
      this.compiled = { files, pages: response.result.pages };
      this.rendered.fire();
    }
    this.pages.classList.toggle('typst-preview--stale', failed);
    // A newer update is waiting: these diagnostics describe outdated text.
    if (!superseded()) this.diagnosed.fire(response.result.diagnostics);
  }

  private async lookUp({ path, from }: Reveal, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'cursor', path, offset: from });
    if (superseded() || response.type !== 'cursor' || response.positions.length === 0) return;
    this.follow(response.positions[0]);
  }

  private setZoom(zoom: Zoom): void {
    const before = this.scroller.scrollTop / (this.scroller.scrollHeight || 1);
    this.zoom = zoom;
    this.list.setZoom(zoom);
    this.scroller.scrollTop = before * this.scroller.scrollHeight;
    this.updateStatus();
  }

  private visiblePage(): { index: number; count: number } {
    const rects = this.list.elements().map((element) => element.getBoundingClientRect());
    return { index: mostVisible(rects, this.scroller.getBoundingClientRect()), count: rects.length };
  }

  /** Lets the toolbar items show the new view (zoom, page number) at most once per frame. */
  private scheduleStatus(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.updateStatus());
  }

  private updateStatus(): void {
    for (const { view } of this.items) view.update?.();
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = event.target as Element;
    const hit = this.list.pageAt(target);
    if (!hit) return;
    const rect = hit.element.getBoundingClientRect();
    const scale = hit.page.width / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    const response = await this.request({ type: 'click', page: hit.index, x, y });
    if (response.type !== 'click' || response.jump?.kind !== 'source') return;
    // where the clicked source node is drawn (every line/page)
    this.clickHighlight.set(response.jump.boxes);
    const { path, from, to } = response.jump;
    this.clicked.fire({ path, from, to });
  }

  /** Scrolls to where the cursor's text is drawn, if that is off-screen; nothing is drawn there. */
  private follow({ page, x, y }: Position): void {
    const hit = this.list.at(page);
    if (!hit) return;
    // an invisible point at the spot, only to measure and scroll to
    const spot = overlay(hit.element, 'typst-preview__follow-spot', {
      left: (x / hit.page.width) * 100,
      top: (y / hit.page.height) * 100,
    });
    this.scrollIntoView(spot);
    spot.remove();
  }

  /** Scrolls the preview (and nothing around it) so `target` is centred, unless it is already visible. */
  private scrollIntoView(target: HTMLElement): void {
    const viewport = this.scroller.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (isInside(rect, viewport)) return;
    this.scroller.scrollBy({
      top: rect.top + rect.height / 2 - (viewport.top + viewport.height / 2),
      left: rect.left - (viewport.left + viewport.width / 2),
      behavior: 'smooth',
    });
  }

  private request(body: RequestBody): Promise<Response> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...body, id });
    });
  }
}

/** Toolbar order (see `ToolbarPlacement`): the group `navigation` first, the other groups by name, then `order`. */
function byPlacement(a: { group: string; order: number }, b: { group: string; order: number }): number {
  if (a.group !== b.group) {
    if (a.group === 'navigation' || b.group === 'navigation') return a.group === 'navigation' ? -1 : 1;
    return a.group < b.group ? -1 : 1;
  }
  return a.order - b.order;
}

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
