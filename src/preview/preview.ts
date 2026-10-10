import type { Box, Diagnostic, Jump, Position } from '../engine/engine';
import { DEFAULT_FONT_URLS } from '../engine/default-fonts';
import wasmUrl from '../engine/wasm/typst_engine_bg.wasm?url&no-inline';
import { FileSender, type FileContent } from './project-files';
import { isInside, mostVisible, percentOfPage } from './geometry';
import { LatestOnly } from './latest-only';
import { PageList } from './page-list';
import type { Init, Request, Response } from './protocol';
import { PreviewToolbar, type ZoomRequest } from './toolbar';
import { stepZoom, zoomLabel, type Zoom } from './zoom';

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

/** Minimum time between two cursor → preview lookups while the cursor moves. */
const REVEAL_INTERVAL_MS = 80;

/**
 * The live preview: compiles Typst in a worker and shows the pages as SVG,
 * with a toolbar for zoom and the current page number.
 *
 * Hides the worker, request coalescing (only the newest pending update or
 * reveal is processed), lazy and incremental page rendering, and the px ↔ pt
 * mapping for click-to-source and source-to-preview reveal.
 */
export class Preview {
  private readonly worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, (response: Response) => void>();
  private readonly pane: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly list: PageList;
  private readonly toolbar: PreviewToolbar;
  private readonly compiles: LatestOnly<Compile>;
  private readonly reveals: LatestOnly<Reveal>;
  private readonly resizeObserver: ResizeObserver | null;
  private highlights: HTMLElement[] = [];
  private zoom: Zoom = 'fit';
  private nextId = 0;
  private readonly sender = new FileSender();
  private frame = 0;

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

    this.worker.postMessage({ type: 'init', wasm: wasmUrl, fonts: DEFAULT_FONT_URLS } satisfies Init);
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

  destroy(): void {
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
    const hit = this.list.pageAt(event.target as Element);
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
