import type { PlacedPresence } from '../../core/typst-document/typst-document';
import type { Box, Diagnostic, Jump, Page, Position } from '../../core/typst-engine/typst-engine';
import { changeBars, drawnRanges } from './pages/pages';
import { DEFAULT_FONT_URLS, ENGINE_WASM_URL } from '../../core/typst-engine/engine-assets';
import type { FileContent } from '../../core/project/project';
import { FileSender } from './worker/worker';
import { isInside, mostVisible, percentOfPage } from './pages/pages';
import { LatestOnly } from './latest-only';
import { PageList } from './pages/pages';
import { presenceMarkers } from './pages/pages';
import { snippet, type Snippet } from './pages/pages';
import { startEngineWorker, type Init, type Request, type Response } from './worker/worker';
import { PreviewToolbar, type ZoomRequest } from './toolbar';
import { stepZoom, zoomLabel, type Zoom } from './pages/pages';

export type { Snippet } from './pages/pages';

export interface PreviewOptions {
  /** Called when the user clicks something in the preview that has a source location. */
  onJump?(jump: Extract<Jump, { kind: 'source' }>): void;
  /**
   * Called with the errors and warnings of the newest text passed to
   * `update()`. Results of outdated texts are not reported, so the offsets
   * always match the text that was last given.
   */
  onDiagnostics?(diagnostics: Diagnostic[]): void;
}

type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;
type Compile = { files: Record<string, FileContent>; main: string };
type Reveal = { path: string; offset: number };
type Changes = { path: string; ranges: { from: number; to: number }[] };

/** Minimum time between two cursor → preview lookups while the cursor moves. */
const REVEAL_INTERVAL_MS = 80;
/** Minimum time between two lookups of the other users' places. */
const PRESENCE_INTERVAL_MS = 250;

/**
 * The live preview: compiles Typst in a worker and shows the pages as SVG,
 * with a toolbar for zoom and the current page number.
 *
 * Hides the worker, request coalescing (only the newest pending update or
 * reveal is processed), lazy and incremental page rendering, and the px ↔ pt
 * mapping for click-to-source and source-to-preview reveal.
 */
export class Preview {
  private readonly worker = startEngineWorker();
  private readonly pending = new Map<number, (response: Response) => void>();
  private readonly pane: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly list: PageList;
  private readonly toolbar: PreviewToolbar;
  private readonly compiles: LatestOnly<Compile>;
  private readonly reveals: LatestOnly<Reveal>;
  private readonly presenceLookups: LatestOnly<readonly PlacedPresence[]>;
  private presence: readonly PlacedPresence[] = [];
  private presenceMarkers: HTMLElement[] = [];
  private readonly resizeObserver: ResizeObserver | null;
  private highlights: HTMLElement[] = [];
  private changes: Changes | null = null;
  private changeBars: HTMLElement[] = [];
  private changeDraws = 0;
  private zoom: Zoom = 'fit';
  private nextId = 0;
  private readonly sender = new FileSender();
  private frame = 0;
  /** The files and pages of the last successful compilation. */
  private compiled: { files: Record<string, FileContent>; pages: Page[] } = { files: {}, pages: [] };
  private readonly renderListeners = new Set<() => void>();

  constructor(
    private readonly container: HTMLElement,
    private readonly options: PreviewOptions = {},
  ) {
    const doc = container.ownerDocument;
    this.pane = div(doc, 'typst-preview-pane');
    this.scroller = div(doc, 'typst-preview__scroller');
    this.pages = div(doc, 'typst-preview');
    this.pages.dataset.testid = 'typst-preview';
    this.toolbar = new PreviewToolbar(doc, (request) => this.setZoom(request));
    this.list = new PageList(this.pages, { root: this.scroller });
    this.scroller.append(this.pages);
    this.pane.append(this.toolbar.element, this.scroller);
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
    this.presenceLookups = new LatestOnly((presences, superseded) => this.placePresence(presences, superseded), {
      interval: PRESENCE_INTERVAL_MS,
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
   * Flashes where the text at `offset` in `path` appears, scrolling there only
   * if it is off-screen. Cheap to call on every cursor move: calls are
   * throttled and only the newest is looked up.
   */
  reveal(path: string, offset: number): void {
    this.reveals.push({ path, offset });
  }

  /**
   * Marks where the given source ranges of `path` are drawn with change bars
   * in the page margin, after this and every following compilation, until
   * called with null. The ranges refer to the text last passed to `update()`;
   * an empty range (a deletion) marks the text around it.
   */
  showChanges(path: string, ranges: { from: number; to: number }[] | null): void {
    this.changes = ranges ? { path, ranges: drawnRanges(ranges) } : null;
    void this.drawChanges();
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
   * Marks where other users are with their initials in their color, at
   * their caret (`head`) in `path`, until called again; redrawn after every
   * compilation. Cheap to call often: lookups are throttled, only the newest
   * presences are looked up.
   */
  showPresence(presences: readonly PlacedPresence[]): void {
    this.presence = presences;
    this.presenceLookups.push(presences);
  }

  /** Calls `listener` after every successful compilation (snippets may have changed). Returns the unsubscribe function. */
  onRender(listener: () => void): () => void {
    this.renderListeners.add(listener);
    return () => this.renderListeners.delete(listener);
  }

  destroy(): void {
    this.renderListeners.clear();
    this.worker.terminate();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.list.destroy();
    this.pane.remove();
  }

  private async compile({ files, main }: Compile, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'compile', files: this.sender.encode(files), main });
    if (response.type !== 'compile') return;
    // Keep showing the last good pages while the document has errors, dimmed as stale.
    const failed = response.result.pages.length === 0;
    if (!failed) {
      this.clearHighlight();
      this.list.render(response.result.pages);
      this.scheduleStatus();
      if (!superseded()) void this.drawChanges();
      this.compiled = { files, pages: response.result.pages };
      if (this.presence.length > 0) this.presenceLookups.push(this.presence);
      for (const listener of this.renderListeners) listener();
    }
    this.pages.classList.toggle('typst-preview--stale', failed);
    // A newer update is waiting: these diagnostics describe outdated text.
    if (!superseded()) this.options.onDiagnostics?.(response.result.diagnostics);
  }

  private async lookUp({ path, offset }: Reveal, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'cursor', path, offset });
    if (superseded() || response.type !== 'cursor' || response.positions.length === 0) return;
    this.flash(response.positions[0]);
  }

  /** Replaces the presence markers with those at the places the engine draws `presences`' carets. */
  private async placePresence(presences: readonly PlacedPresence[], superseded: () => boolean): Promise<void> {
    const found = await Promise.all(
      presences.map(async ({ id, user, path, head }) => {
        const response = await this.request({ type: 'cursor', path, offset: head });
        return { id, user, positions: response.type === 'cursor' ? response.positions : [] };
      }),
    );
    if (superseded()) return;
    for (const element of this.presenceMarkers.splice(0)) element.remove();
    for (const marker of presenceMarkers(found, (page) => this.list.at(page)?.page)) {
      const element = overlay(this.list.at(marker.page)!.element, 'typst-preview__presence', { left: marker.left, top: marker.top });
      element.textContent = marker.label;
      element.title = marker.title;
      element.dataset.user = marker.title;
      element.style.setProperty('--typst-remote-color', marker.color);
      element.style.setProperty('--typst-remote-text', marker.textColor);
      element.style.setProperty('--typst-presence-stack', String(marker.stack));
      this.presenceMarkers.push(element);
    }
  }

  private setZoom(request: ZoomRequest): void {
    const before = this.scroller.scrollTop / (this.scroller.scrollHeight || 1);
    this.zoom = typeof request === 'string' && request !== 'fit' ? stepZoom(this.list.scale(), request === 'in' ? 1 : -1) : request;
    this.list.setZoom(this.zoom);
    this.scroller.scrollTop = before * this.scroller.scrollHeight;
    this.updateStatus();
  }

  /** Updates zoom label and page number at most once per frame. */
  private scheduleStatus(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.updateStatus());
  }

  private updateStatus(): void {
    this.toolbar.showZoom(this.zoom === 'fit' ? `Fit · ${zoomLabel(this.list.scale())}` : zoomLabel(this.zoom));
    const rects = this.list.elements().map((element) => element.getBoundingClientRect());
    this.toolbar.showPage(mostVisible(rects, this.scroller.getBoundingClientRect()) + 1, rects.length);
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
    this.highlightBoxes(response.jump.boxes);
    this.options.onJump?.(response.jump);
  }

  /** Outlines where the clicked source node is drawn (every line/page), until the next click or recompile. */
  private highlightBoxes(boxes: Box[]): void {
    this.clearHighlight();
    for (const box of boxes) {
      const hit = this.list.at(box.page);
      if (hit) this.highlights.push(overlay(hit.element, 'typst-preview__highlight', percentOfPage(box, hit.page)));
    }
  }

  /** Replaces the change bars with those for the current changes in the last compiled document. */
  private async drawChanges(): Promise<void> {
    const draw = ++this.changeDraws;
    const boxes = this.changes?.ranges.length ? await this.request({ type: 'boxes', ...this.changes }) : null;
    if (draw !== this.changeDraws) return;
    for (const element of this.changeBars.splice(0)) element.remove();
    if (boxes?.type !== 'boxes') return;
    for (const bar of changeBars(boxes.boxes)) {
      const hit = this.list.at(bar.page);
      if (!hit) continue;
      const box = percentOfPage({ x: 0, y: bar.y, w: 0, h: bar.h }, hit.page);
      this.changeBars.push(overlay(hit.element, 'typst-preview__change-bar', { top: box.top, height: box.height }));
    }
  }

  private clearHighlight(): void {
    for (const element of this.highlights) element.remove();
    this.highlights = [];
  }

  private flash({ page, x, y }: Position): void {
    const hit = this.list.at(page);
    if (!hit) return;
    const marker = overlay(hit.element, 'typst-preview__flash', {
      left: (x / hit.page.width) * 100,
      top: (y / hit.page.height) * 100,
    });
    marker.addEventListener('animationend', () => marker.remove());
    this.scrollIntoView(marker);
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

/** An absolutely positioned element on a page, placed in percent of the page size. */
function overlay(page: HTMLElement, className: string, box: Partial<Record<'left' | 'top' | 'width' | 'height', number>>) {
  const element = div(page.ownerDocument, className);
  for (const [key, value] of Object.entries(box)) element.style.setProperty(key, `${value}%`);
  page.append(element);
  return element;
}
