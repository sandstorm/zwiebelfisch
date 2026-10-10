// Preview: the live preview of a Typst project, compiled in a worker, with hit-testing. Entry of hosts/preview/.
// See ARCHITECTURE.md, "Preview", and docs/2026_10_10_extensions-architecture.md.
// Why a host: the preview keeps the mechanism — the engine worker and its protocol, coalesced compiles, the
// lazily rendered page list, hit-testing, scrolling and reveal. What sits on top of it is contributed: toolbar
// items (zoom, "Follow cursor", page number, "Download PDF"), the PDF variants a menu offers, and overlays on
// the pages. So a feature adds to the preview without the preview knowing it.
import { Disposable } from '../../core/disposable/disposable';
import { type Event, EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Diagnostic, Jump, Page, PdfResult, Position } from '../../core/typst-engine/typst-engine';
import { isInside, mostVisible, overlay, OverlayLayer, PageList, snippet, type Snippet, type Zoom } from './pages/pages';
import { DEFAULT_FONT_URLS, ENGINE_WASM_URL } from '../../core/typst-engine/engine-assets';
import type { FileContent } from '../../core/project/project';
import { FileSender, type Init, type Request, type Response, startEngineWorker } from './worker/worker';
import { LatestOnly } from './latest-only';
import type { PageOverlay, PdfVariant, PreviewContext, PreviewToolbarItem, ToolbarItemView } from './contribution';

export type { PageOverlay, PdfFile, PdfVariant, PreviewContext, PreviewToolbarItem, ToolbarItemView } from './contribution';
export type { Snippet, Zoom } from './pages/pages';

/**
 * The preview as extensions see it (`ExtensionContext.preview`): its contribution points, and what its engine
 * answers about the project it compiles.
 */
export interface PreviewContributions {
  /** Adds a control to the toolbar, after those registered before, until disposed. */
  registerToolbarItem(item: PreviewToolbarItem): Disposable;
  /** Offers a PDF to the toolbar items that download one (`PreviewContext.pdfVariants`), until disposed. */
  registerPdfVariant(variant: PdfVariant): Disposable;
  /** A layer of boxes drawn over the pages, as elements of class `className`. */
  createOverlay(className: string): PageOverlay;
  /**
   * The errors and warnings of each compilation of the newest files given to the preview (results of outdated
   * files are not reported, so the offsets match the text last given).
   */
  readonly onDidChangeDiagnostics: Event<readonly Diagnostic[]>;
  /** After every successful compilation (snippets may have changed). */
  readonly onDidRender: Event<void>;
  snippet(path: string, from: number, to: number, text: string): Promise<Snippet | null>;
  exportPdf(main: string, sources?: Record<string, string>): Promise<PdfResult>;
}

export interface PreviewOptions {
  /** Called when the user clicks something in the preview that has a source location. */
  onJump?(jump: Extract<Jump, { kind: 'source' }>): void;
}

type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;
type Compile = { files: Record<string, FileContent>; main: string };
type Reveal = { path: string; offset: number };

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
  private readonly items: ToolbarItemView[] = [];
  private readonly variants: PdfVariant[] = [];
  private readonly overlays = new Set<OverlayLayer>();
  /** Outlines the clicked text, until the next click or successful compile. */
  private readonly clickHighlight: PageOverlay;
  private zoom: Zoom = 'fit';
  private nextId = 0;
  private readonly sender = new FileSender();
  private frame = 0;
  /** The files and pages of the last successful compilation. */
  private compiled: { files: Record<string, FileContent>; pages: Page[] } = { files: {}, pages: [] };
  private readonly rendered = new EventEmitter<void>();
  private readonly diagnosed = new EventEmitter<readonly Diagnostic[]>();
  readonly onDidRender = this.rendered.event;
  readonly onDidChangeDiagnostics = this.diagnosed.event;
  private following = true;
  /** The newest place asked for, also while not following: switching following on goes there. */
  private lastReveal: Reveal | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly options: PreviewOptions = {},
  ) {
    const doc = container.ownerDocument;
    this.pane = div(doc, 'typst-preview-pane');
    this.toolbar = div(doc, 'typst-preview__toolbar');
    this.toolbar.dataset.testid = 'typst-preview-toolbar';
    this.scroller = div(doc, 'typst-preview__scroller');
    this.pages = div(doc, 'typst-preview');
    this.pages.dataset.testid = 'typst-preview';
    this.list = new PageList(this.pages, { root: this.scroller });
    this.clickHighlight = this.createOverlay('typst-preview__highlight');
    this.context = this.itemContext(doc);
    this.scroller.append(this.pages);
    this.pane.append(this.toolbar, this.scroller);
    container.append(this.pane);

    this.pages.addEventListener('click', (event) => void this.handleClick(event));
    this.scroller.addEventListener('scroll', () => this.scheduleStatus(), { passive: true });
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.scheduleStatus());
    this.resizeObserver?.observe(this.scroller);
    this.compiles = new LatestOnly((compile, superseded) => this.compile(compile, superseded), {
      onIdle: () => this.container.dispatchEvent(new CustomEvent('typst-preview-idle', { bubbles: true })),
    });
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
  update(files: Record<string, FileContent>, main = '/main.typ'): void {
    this.compiles.push({ files, main });
  }

  /**
   * Scrolls to where the text at `offset` in `path` appears, only if it is
   * off-screen (no marker: following the cursor should not draw anything). Cheap to call on every cursor move: calls are
   * throttled and only the newest is looked up. Does nothing while following
   * is off (`PreviewContext.setFollowing`, "Follow cursor"), until it is switched on again.
   */
  reveal(path: string, offset: number): void {
    this.lastReveal = { path, offset };
    if (this.following) this.reveals.push(this.lastReveal);
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
   * A PDF of `main` (null with the errors when it does not compile), from the
   * files last passed to `update()`, with `sources` replacing or adding text
   * files for this export only. Waits for running compilations; the preview
   * itself does not change.
   */
  async exportPdf(main: string, sources: Record<string, string> = {}): Promise<PdfResult> {
    await this.compiles.idle();
    const response = await this.request({ type: 'pdf', main, sources });
    if (response.type === 'pdf') return response.result;
    throw new Error(response.type === 'error' ? response.message : 'unexpected answer from the engine');
  }

  registerToolbarItem(item: PreviewToolbarItem): Disposable {
    const view = item(this.context);
    this.toolbar.append(...view.elements);
    this.items.push(view);
    this.scheduleStatus();
    return new Disposable(() => this.removeItem(view));
  }

  registerPdfVariant(variant: PdfVariant): Disposable {
    this.variants.push(variant);
    return new Disposable(() => this.variants.splice(this.variants.indexOf(variant), 1));
  }

  createOverlay(className: string): PageOverlay {
    const layer = new OverlayLayer(this.list, className);
    this.overlays.add(layer);
    return {
      set: (boxes) => layer.set(boxes),
      dispose: () => {
        layer.set([]);
        this.overlays.delete(layer);
      },
    };
  }

  destroy(): void {
    this.rendered.dispose();
    this.diagnosed.dispose();
    for (const item of [...this.items]) this.removeItem(item);
    this.worker.terminate();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.list.destroy();
    this.pane.remove();
  }

  private itemContext(doc: Document): PreviewContext {
    return {
      ownerDocument: doc,
      zoom: () => this.zoom,
      setZoom: (zoom) => this.setZoom(zoom),
      scale: () => this.list.scale(),
      visiblePage: () => this.visiblePage(),
      isFollowing: () => this.following,
      setFollowing: (on) => this.setFollowing(on),
      pdfVariants: () => [...this.variants],
    };
  }

  private removeItem(item: ToolbarItemView): void {
    const index = this.items.indexOf(item);
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
      for (const layer of this.overlays) layer.redraw();
      this.scheduleStatus();
      this.compiled = { files, pages: response.result.pages };
      this.rendered.fire();
    }
    this.pages.classList.toggle('typst-preview--stale', failed);
    // A newer update is waiting: these diagnostics describe outdated text.
    if (!superseded()) this.diagnosed.fire(response.result.diagnostics);
  }

  private async lookUp({ path, offset }: Reveal, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'cursor', path, offset });
    if (superseded() || response.type !== 'cursor' || response.positions.length === 0) return;
    this.follow(response.positions[0]);
  }

  private setFollowing(on: boolean): void {
    this.following = on;
    if (on && this.lastReveal) this.reveals.push(this.lastReveal);
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
    for (const item of this.items) item.update?.();
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
    this.options.onJump?.(response.jump);
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

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}
