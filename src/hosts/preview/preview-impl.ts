// See PreviewContributions in preview.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import type { TypstDiagnostic, Page, PageRect, PdfEntry, PdfResult, Position } from '../../core/typst-engine/typst-engine';
import { isInside, measure, mostVisible, pointOnPage, Px } from './pages/geometry';
import { overlay, OverlayLayer } from './pages/overlays';
import { PageList } from './pages/page-list';
import { snippet } from './pages/snippet';
import type { FileContent } from '../../core/project/project';
import { EngineWorker } from './worker/worker';
import { LatestOnly } from './latest-only/latest-only';
import { NO_MENUS, PreviewToolbar, type PreviewMenus } from './toolbar/toolbar';
import type {
  EngineCrash,
  LoadEvent,
  PdfExportOption,
  PreviewContributions,
  PreviewEntry,
  PreviewOutput,
  PreviewRenderer,
  PreviewRendererInfo,
  PreviewRendererView,
  PreviewViewOption,
  PageClick,
  PageOverlay,
  RenderedSnippet,
  VisiblePage,
  Zoom,
} from './preview';
import css from './preview.css?inline';

/**
 * The live preview: compiles the project in a worker and shows the pages as SVG, under a toolbar (the menu
 * `preview/title`, from `options.menus`).
 *
 * The widget (editor/widget) makes it the right side's panel and gives it the project's files on every change. It compiles whether
 * shown or not, so diagnostics, snippets and clicks always belong to the newest files. Extensions add through
 * `PreviewContributions`:
 * - PDF export options and view options
 * - other renderers than the pages (the HTML preview)
 * - page overlays: boxes drawn over the pages (the click outline, the selection shading)
 * - pane overlays over the whole pane (the loading note), told by load and crash events
 *
 * Compiling never falls behind typing: files outdated before their turn are skipped. A crashed engine is restarted
 * with the newest files once per `update()`.
 */
export class Preview implements PreviewContributions {
  private readonly engine: EngineWorker;
  /** Whether the engine was restarted after a crash since the last `update()`. */
  private restarted = false;
  private readonly pane: HTMLElement;
  private readonly toolbar: PreviewToolbar;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly list: PageList;
  private readonly compiles: LatestOnly<Compile>;
  private readonly reveals: LatestOnly<Reveal>;
  private readonly resizeObserver: ResizeObserver | null;
  /** The PDF export options, in registration order. */
  private readonly exportOptions: PdfExportOption[] = [];
  /** The view options, in registration order. */
  private readonly registeredViewOptions: PreviewViewOption[] = [];
  /** The renderers registered besides the built-in pages, in registration order. */
  private readonly registeredRenderers: PreviewRenderer[] = [];
  /** The renderer `setActiveRenderer` asked for last (maybe not registered yet: then the pages are shown). */
  private requestedRenderer = PAGES.id;
  /** The registered renderer shown instead of the pages; null: the pages are shown. */
  private active: ActiveRenderer | null = null;
  /** What `reveal` asked for last: a renderer shown later starts there. */
  private revealed: Reveal | null = null;
  /** The pages compiled for snippets while another renderer is active, of `compile`. */
  private pagesOnDemand: { compile: Compile; done: Promise<void> } | null = null;
  /** The view options' values by id as last set (also of ids not registered yet); the others are at their default. */
  private viewOptionValues: Readonly<Record<string, boolean>> = {};
  /** What `update()` gave last, compiled again when the view options change; null before the first update. */
  private latest: Compile | null = null;
  /** The overlays of `createPageOverlay` not disposed yet, drawn again after every render. */
  private readonly overlays = new Set<OverlayLayer>();
  private zoomed: Zoom = 'fit';
  private frame = 0;
  /** The files and pages of the last successful compilation. */
  private compiled: { files: Record<string, FileContent>; pages: Page[] } = { files: {}, pages: [] };
  private readonly rendered = new EventEmitter<void>();
  private readonly diagnosed = new EventEmitter<readonly TypstDiagnostic[]>();
  private readonly clicked = new EventEmitter<PageClick>();
  private readonly viewOptionsChanged = new EventEmitter<void>();
  private readonly engineMemoryChanged = new EventEmitter<void>();
  private readonly renderersChanged = new EventEmitter<void>();
  private readonly viewMoved = new EventEmitter<void>();
  private readonly loaded = new EventEmitter<LoadEvent>();
  private readonly crashes = new EventEmitter<EngineCrash>();
  /** The engine's memory as its last compile answered. */
  private memoryInUse = 0;
  readonly onDidChangeViewOptions = this.viewOptionsChanged.event;
  readonly onDidRender = this.rendered.event;
  readonly onDidChangeDiagnostics = this.diagnosed.event;
  readonly onDidClickPage = this.clicked.event;
  readonly onDidChangeEngineMemory = this.engineMemoryChanged.event;
  readonly onDidChangeRenderers = this.renderersChanged.event;
  readonly onDidChangeView = this.viewMoved.event;
  readonly onDidLoad = this.loaded.event;
  readonly onDidCrash = this.crashes.event;
  /** The CSS of the pane, toolbar and pages, for the widget to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(container: HTMLElement, options: { menus?: PreviewMenus } = {}) {
    const doc = container.ownerDocument;
    this.pane = div(doc, 'zwf-preview-pane');
    const toolbar = div(doc, 'zwf-preview__toolbar');
    toolbar.dataset.testid = 'zwf-preview-toolbar';
    this.scroller = div(doc, 'zwf-preview__scroller');
    this.pages = div(doc, 'zwf-preview');
    this.pages.dataset.testid = 'zwf-preview';
    this.list = new PageList(this.pages, { root: this.scroller });
    this.scroller.append(this.pages);
    this.pane.append(toolbar, this.scroller);
    container.append(this.pane);
    this.toolbar = new PreviewToolbar(toolbar, options.menus ?? NO_MENUS, () => ({ previewRenderer: this.activeRenderer }));

    this.pages.addEventListener('click', (event) => void this.handleClick(event));
    this.scroller.addEventListener('scroll', () => this.scheduleViewChange(), { passive: true });
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.scheduleViewChange());
    this.resizeObserver?.observe(this.scroller);
    this.compiles = new LatestOnly((compile, superseded) => this.compile(compile, superseded), { interval: COMPILE_INTERVAL_MS });
    this.reveals = new LatestOnly((reveal, superseded) => this.lookUp(reveal, superseded), {
      interval: REVEAL_INTERVAL_MS,
    });

    this.engine = new EngineWorker({
      onDidLoad: (event) => this.loaded.fire(event),
      onDidCrash: (message) => this.crashed(message),
    });
  }

  /**
   * Shows the given project files, compiling `main`. Files map absolute
   * paths (`/main.typ`, `/img/logo.png`) to Typst source text or to bytes.
   * `@preview` packages the document imports are downloaded on first use.
   * Cheap to call on every keystroke: a compile starts at most every 150 ms,
   * updates arriving meanwhile are collapsed into one, and bytes that are the
   * same `Uint8Array` as last time are not sent to the worker again.
   */
  update(files: Record<string, FileContent>, main: string): void {
    this.latest = { files, main };
    this.restarted = false;
    // off after crashing twice: new files may not crash it
    this.startEngine();
    this.compiles.push(this.latest);
  }

  reveal(path: ProjectPath, { from }: SourceRange): void {
    this.revealed = { path, from };
    this.reveals.push(this.revealed);
  }

  createPageOverlay(className: string): PageOverlay {
    const layer = new OverlayLayer(this.list, className, () => this.overlays.delete(layer));
    this.overlays.add(layer);
    return layer;
  }

  async boxesFor(path: ProjectPath, ranges: readonly SourceRange[], text: string): Promise<readonly PageRect[]> {
    await this.compiles.idle();
    if (ranges.length === 0 || this.compiled.files[path] !== text) return [];
    const response = await this.engine.request({ type: 'boxes', path, ranges: [...ranges] });
    return response.type === 'boxes' ? response.boxes : [];
  }

  /**
   * How source range `range` of `path` looks in the document: its page cut
   * down to where that range draws text, shapes or images (first page only).
   * Null when it draws nothing, or when `text` is not what that range held at
   * the last successful compilation (it was edited, or the document has
   * errors). Waits for running compilations, so it answers for the newest
   * text passed to `update()`.
   */
  async snippet(path: ProjectPath, range: SourceRange, text: string): Promise<RenderedSnippet | null> {
    await this.compiles.idle();
    if (this.active) await this.pagesOfLatest();
    const { files, pages } = this.compiled;
    const compiled = files[path];
    if (typeof compiled !== 'string' || compiled.slice(range.from, range.to) !== text) return null;
    const response = await this.engine.request({ type: 'boxes', path, ranges: [range] });
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
    const response = await this.engine.request({ type: 'pdf', main: entry.main, sources: { ...entry.sources } });
    if (response.type === 'pdf') return response.result;
    throw new Error(response.type === 'error' ? response.message : 'unexpected answer from the engine');
  }

  get engineMemory(): number {
    return this.memoryInUse;
  }

  get isEmpty(): boolean {
    return this.active ? !this.active.shown : this.compiled.pages.length === 0;
  }

  registerPaneOverlay(element: HTMLElement): Disposable {
    this.scroller.append(element);
    return new Disposable(() => element.remove());
  }

  registerRenderer(renderer: PreviewRenderer): Disposable {
    if (this.renderers().some(({ id }) => id === renderer.id)) throw new Error(`Preview renderer '${renderer.id}' is already registered`);
    this.registeredRenderers.push(renderer);
    this.showRenderer();
    this.renderersChanged.fire();
    return new Disposable(() => {
      const index = this.registeredRenderers.indexOf(renderer);
      if (index < 0) return;
      this.registeredRenderers.splice(index, 1);
      this.showRenderer();
      this.renderersChanged.fire();
    });
  }

  renderers(): readonly PreviewRendererInfo[] {
    return [PAGES, ...this.registeredRenderers.map(({ id, label }) => ({ id, label }))];
  }

  get activeRenderer(): string {
    return this.active?.renderer.id ?? PAGES.id;
  }

  setActiveRenderer(id: string): void {
    this.requestedRenderer = id;
    if (this.showRenderer()) this.renderersChanged.fire();
  }

  get zoom(): Zoom {
    return this.zoomed;
  }

  setZoom(zoom: Zoom): void {
    const before = this.scroller.scrollTop / (this.scroller.scrollHeight || 1);
    this.zoomed = zoom;
    this.list.setZoom(zoom);
    this.scroller.scrollTop = before * this.scroller.scrollHeight;
    this.scheduleViewChange();
  }

  get scale(): number {
    return this.list.scale();
  }

  get visiblePage(): VisiblePage {
    const rects = this.list.elements().map(measure);
    return { index: mostVisible(rects, measure(this.scroller)), count: rects.length };
  }

  registerPdfExportOption(option: PdfExportOption): Disposable {
    if (this.exportOptions.some((other) => other.id === option.id)) throw new Error(`PDF export option '${option.id}' is already registered`);
    this.exportOptions.push(option);
    return new Disposable(() => {
      const index = this.exportOptions.indexOf(option);
      if (index >= 0) this.exportOptions.splice(index, 1);
    });
  }

  pdfExportOptions(): readonly PdfExportOption[] {
    return [...this.exportOptions];
  }

  registerViewOption(option: PreviewViewOption): Disposable {
    if (this.registeredViewOptions.some((other) => other.id === option.id)) throw new Error(`View option '${option.id}' is already registered`);
    this.registeredViewOptions.push(option);
    this.recompile();
    this.viewOptionsChanged.fire();
    return new Disposable(() => {
      const index = this.registeredViewOptions.indexOf(option);
      if (index < 0) return;
      this.registeredViewOptions.splice(index, 1);
      this.recompile();
      this.viewOptionsChanged.fire();
    });
  }

  viewOptions(): readonly PreviewViewOption[] {
    return [...this.registeredViewOptions];
  }

  setViewOptionValues(values: Readonly<Record<string, boolean>>): void {
    this.viewOptionValues = { ...values };
    this.recompile();
  }

  dispose(): void {
    this.active?.view.dispose();
    this.renderersChanged.dispose();
    this.viewMoved.dispose();
    this.rendered.dispose();
    this.diagnosed.dispose();
    this.clicked.dispose();
    this.viewOptionsChanged.dispose();
    this.engineMemoryChanged.dispose();
    this.loaded.dispose();
    this.crashes.dispose();
    this.toolbar.dispose();
    this.engine.dispose();
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    this.list.dispose();
    this.pane.remove();
  }

  /**
   * Shows the requested renderer if it is registered, else the pages; compiles for it when that changed. Returns
   * whether it changed.
   */
  private showRenderer(): boolean {
    const renderer = this.registeredRenderers.find(({ id }) => id === this.requestedRenderer) ?? null;
    if (renderer === (this.active?.renderer ?? null)) return false;
    if (this.active) {
      this.active.view.dispose();
      this.active.container.remove();
    }
    this.active = null;
    if (renderer) {
      const container = div(this.pane.ownerDocument, 'zwf-preview__renderer');
      // after the pages, under the pane overlays
      this.pages.after(container);
      this.active = { renderer, container, view: renderer.create(container), shown: false };
    }
    this.pages.hidden = renderer !== null;
    this.toolbar.refresh();
    this.recompile();
    return true;
  }

  /** Compiles the last files again with the renderer and view options as they are now. */
  private recompile(): void {
    if (this.latest) this.compiles.push(this.latest);
  }

  private async compile(compile: Compile, superseded: () => boolean): Promise<void> {
    if (this.active) await this.compileHtml(compile, this.active, superseded);
    else await this.compilePages(compile, superseded);
  }

  /**
   * Compiles the pages and shows them. `quiet`: for snippets while another renderer is active, so neither diagnostics
   * nor `onDidRender` (the active renderer's compile tells those).
   */
  private async compilePages({ files, main }: Compile, superseded: () => boolean, quiet = false): Promise<void> {
    const compiled = this.withViewOptions({ files, main }, 'pages');
    const response = await this.engine.request({ type: 'compile', ...compiled });
    if (response.type !== 'compile') return;
    this.answered(response.memoryInUse);
    const { pages } = response.result;
    // Keep showing the last good pages while the document has errors, dimmed as stale.
    const failed = pages.length === 0;
    if (!failed) {
      this.list.render(pages);
      for (const layer of this.overlays) layer.redraw();
      this.scheduleViewChange();
      this.compiled = { files, pages };
      if (!quiet) this.rendered.fire();
    }
    this.pages.classList.toggle('zwf-preview--stale', failed);
    // A newer update is waiting: these diagnostics describe outdated text.
    if (!quiet && !superseded()) this.diagnosed.fire(inProjectFiles(response.result.diagnostics));
  }

  /** Compiles HTML for `active`, with the view options for `html`, and has it show the files; its diagnostics are the preview's. */
  private async compileHtml(compile: Compile, active: ActiveRenderer, superseded: () => boolean): Promise<void> {
    const response = await this.engine.request({ type: 'html', ...this.withViewOptions(compile, 'html') });
    if (response.type !== 'html') return;
    this.answered(response.memoryInUse);
    // Keep showing the last good files while the document has errors, dimmed as stale.
    const failed = response.result.files.length === 0;
    if (!failed && this.active === active) {
      active.view.update({ files: response.result.files });
      // a renderer just shown starts where the cursor was revealed last
      if (!active.shown && this.revealed) this.reveals.push(this.revealed);
      active.shown = true;
      this.rendered.fire();
    }
    active.container.classList.toggle('zwf-preview--stale', failed);
    if (!superseded()) this.diagnosed.fire(inProjectFiles(response.result.diagnostics));
  }

  /**
   * What to compile for `output`: with no prelude from the view options for it, `compile` itself (as an export
   * compiles it), else `VIEW_ENTRY` holding the prelude, then including the main file.
   */
  private withViewOptions({ files, main }: Compile, output: PreviewOutput): Compile {
    let entry: PreviewEntry = { output, prelude: [] };
    for (const option of this.viewOptions()) {
      if ((option.outputs ?? ['pages']).includes(output)) entry = option.apply(entry, this.viewOptionValues[option.id] ?? option.default);
    }
    return entry.prelude.length === 0 ? { files, main } : { files: { ...files, [VIEW_ENTRY]: entryText(entry, main) }, main: VIEW_ENTRY };
  }

  /** A compile answered: its memory is what it says. */
  private answered(memoryInUse: number): void {
    if (memoryInUse === this.memoryInUse) return;
    this.memoryInUse = memoryInUse;
    this.engineMemoryChanged.fire();
  }

  /** While another renderer is active, compiles the pages of the newest files once, when a snippet needs them. */
  private pagesOfLatest(): Promise<void> {
    const latest = this.latest;
    if (!latest || this.compiled.files === latest.files) return Promise.resolve();
    if (this.pagesOnDemand?.compile !== latest) this.pagesOnDemand = { compile: latest, done: this.compilePages(latest, () => true, true) };
    return this.pagesOnDemand.done;
  }

  /** Starts the engine again and compiles the newest files, once per `update()`; after that, stays off until the next. */
  private crashed(message: string): void {
    const restart = !this.restarted;
    this.crashes.fire({ message, restarting: restart });
    if (!restart) return;
    this.restarted = true;
    this.startEngine();
    if (this.latest) this.compiles.push(this.latest);
  }

  /** Starts the engine unless it runs, and tells it is loading. */
  private startEngine(): void {
    if (this.engine.start()) this.loaded.fire({ kind: 'starting' });
  }

  private async lookUp({ path, from }: Reveal, superseded: () => boolean): Promise<void> {
    const active = this.active;
    if (active) {
      if (!active.view.reveal) return;
      const found = await this.engine.request({ type: 'elements', path, offset: from });
      if (!superseded() && found.type === 'elements' && this.active === active) active.view.reveal(found.elements);
      return;
    }
    const response = await this.engine.request({ type: 'cursor', path, offset: from });
    if (superseded() || response.type !== 'cursor' || response.positions.length === 0) return;
    this.follow(response.positions[0]);
  }

  /** Tells `onDidChangeView` at most once per frame. */
  private scheduleViewChange(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.viewMoved.fire());
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = event.target as Element;
    const hit = this.list.pageAt(target);
    if (!hit) return;
    const { x, y } = pointOnPage(hit.page, measure(hit.element), Px.of(event.clientX), Px.of(event.clientY));
    const response = await this.engine.request({ type: 'click', page: hit.index, x, y });
    if (response.type !== 'click' || response.jump?.kind !== 'source') return;
    const { from, to, boxes } = response.jump;
    const path = ProjectPath.parse(response.jump.path);
    // a view option's drawing (an outline) is in no project file
    if (path && path !== VIEW_ENTRY) this.clicked.fire({ path, from, to, boxes });
  }

  /** Scrolls to where the cursor's text is drawn, if that is off-screen; nothing is drawn there. */
  private follow({ page, x, y }: Position): void {
    const hit = this.list.at(page);
    if (!hit) return;
    // an invisible point at the spot, only to measure and scroll to
    const spot = overlay(hit.element, 'zwf-preview__follow-spot', {
      left: (x / hit.page.width) * 100,
      top: (y / hit.page.height) * 100,
    });
    this.scrollIntoView(spot);
    spot.remove();
  }

  /** Scrolls the preview (and nothing around it) so `target` is centred, unless it is already visible. */
  private scrollIntoView(target: HTMLElement): void {
    const viewport = measure(this.scroller);
    const rect = measure(target);
    if (isInside(rect, viewport)) return;
    this.scroller.scrollBy({
      top: rect.top + rect.height / 2 - (viewport.top + viewport.height / 2),
      left: rect.left - (viewport.left + viewport.width / 2),
      behavior: 'smooth',
    });
  }
}


type Compile = { files: Record<string, FileContent>; main: string };
/** The registered renderer shown, its container and view; `shown`: it was given a compile's output. */
type ActiveRenderer = { renderer: PreviewRenderer; container: HTMLElement; view: PreviewRendererView; shown: boolean };

/** The built-in renderer: the pages, as SVG. */
const PAGES: PreviewRendererInfo = { id: 'pages', label: 'Pages' };
type Reveal = { path: ProjectPath; from: SourceOffset };

/** The file the preview compiles while a view option is on: their prelude, then the main file included. */
const VIEW_ENTRY = '/.zwf-preview-view.typ';

/** `diagnostics` with what goes wrong in the view options' Typst, which is in no project file, without a path. */
function inProjectFiles(diagnostics: readonly TypstDiagnostic[]): TypstDiagnostic[] {
  return diagnostics.map((d) => (d.path === VIEW_ENTRY ? { ...d, path: null } : d));
}

function entryText({ prelude }: PreviewEntry, main: string): string {
  const path = main.replace(/["\\]/g, (char) => `\\${char}`);
  return `${prelude.join('\n')}\n#include "${path}"\n`;
}

function div(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}

/** Minimum time between two cursor → preview lookups while the cursor moves. */
const REVEAL_INTERVAL_MS = 80;

/**
 * At most this often a compile starts while typing: each one swaps a page's SVG and redraws the raw boxes, so at
 * one compile per keystroke a fast engine (a short document) would do that per keystroke.
 */
const COMPILE_INTERVAL_MS = 150;
