import { Disposable } from '../../core/disposable/disposable';
import { type Event, EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import type { TypstDiagnostic, Page, PageIndex, PdfEntry, PdfResult, Position, Pt } from '../../core/typst-engine/typst-engine';
import { isInside, measure, mostVisible, pointOnPage, Px } from './pages/geometry';
import { overlay, OverlayLayer } from './pages/overlays';
import { PageList } from './pages/page-list';
import { snippet } from './pages/snippet';
import { DEFAULT_FONTS, ENGINE_WASM_URL } from '../../core/engine-assets/engine-assets';
import type { FileContent } from '../../core/project/project';
import { FileSender } from './worker/project-files';
import { PageReceiver } from './worker/page-svgs';
import type { Init, EngineRequest, EngineResponse, WorkerProgress } from './worker/protocol';
import { startEngineWorker } from './worker/worker';
import { LatestOnly } from './latest-only';
import { LoadState } from './progress/load-state';
import { Loader } from './progress/loader';
import css from './preview.css?inline';

/**
 * The live preview: compiles the project in a worker and shows the pages as SVG, under a toolbar.
 *
 * It is the right side's built-in panel. The workbench gives it the project's files on every change, and it compiles
 * whether shown or not, because others need what a compile finds out: the diagnostics, the pictures of raw boxes
 * (`snippet`), where a click or the cursor lands. Compiling never falls behind typing: text that is outdated before
 * its turn is skipped (`LatestOnly`).
 *
 * The preview keeps the mechanism: the engine worker, the page list that renders only the pages near the view,
 * hit-testing, reveal and shading. Extensions add the rest without the preview knowing them: the toolbar items (zoom,
 * page number, "Follow cursor", "Download PDF"), the PDF export options, the view options (Typst run before the main
 * file in the preview only: page guides, box outlines), and when to reveal or shade what (preview-sync). While the
 * engine loads, the pane shows what it waits for. See docs/30_architecture/06_preview.typ.
 */
export class Preview implements PreviewContributions {
  private readonly worker = startEngineWorker();
  private readonly pending = new Map<number, (response: EngineResponse) => void>();
  private readonly loading = new LoadState();
  private readonly loader: Loader;
  private readonly pane: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly scroller: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly list: PageList;
  private readonly compiles: LatestOnly<Compile>;
  private readonly reveals: LatestOnly<Reveal>;
  private readonly highlights: LatestOnly<Highlight>;
  private readonly resizeObserver: ResizeObserver | null;
  /** What toolbar items see of the preview. */
  private readonly context: PreviewContext;
  /** The toolbar's items in toolbar order. */
  private readonly items: { made: ToolbarItemElements; group: string; order: number }[] = [];
  /** The PDF export options, with their priority, in registration order. */
  private readonly exportOptions: { option: PdfExportOption; priority: number }[] = [];
  /** The view options, with their priority, in registration order. */
  private readonly registeredViewOptions: { option: PreviewViewOption; priority: number }[] = [];
  /** The view options' values by id as last set (also of ids not registered yet); the others are at their default. */
  private viewOptionValues: Readonly<Record<string, boolean>> = {};
  /** What `update()` gave last, compiled again when the view options change; null before the first update. */
  private latest: Compile | null = null;
  /** Outlines the clicked text, until the next click, successful compile or `clearClickHighlight`. */
  private readonly clickHighlight: OverlayLayer;
  /** Shades the ranges of `setSelectionHighlight`, looked up again after every successful compile. */
  private readonly selectionHighlight: OverlayLayer;
  private selection: Highlight | null = null;
  private zoom: Zoom = 'fit';
  private nextId = 0;
  private readonly sender = new FileSender();
  private readonly receiver = new PageReceiver();
  private frame = 0;
  /** The files and pages of the last successful compilation. */
  private compiled: { files: Record<string, FileContent>; pages: Page[] } = { files: {}, pages: [] };
  private readonly rendered = new EventEmitter<void>();
  private readonly diagnosed = new EventEmitter<readonly TypstDiagnostic[]>();
  private readonly clicked = new EventEmitter<PageClick>();
  private readonly viewOptionsChanged = new EventEmitter<void>();
  readonly onDidChangeViewOptions = this.viewOptionsChanged.event;
  readonly onDidRender = this.rendered.event;
  readonly onDidChangeDiagnostics = this.diagnosed.event;
  readonly onDidClickPage = this.clicked.event;
  /** The CSS of the pane, toolbar and pages, for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(
    container: HTMLElement,
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
    this.clickHighlight = new OverlayLayer(this.list, 'typst-preview__highlight');
    this.selectionHighlight = new OverlayLayer(this.list, 'typst-preview__selection');
    this.context = this.itemContext(doc);
    this.loader = new Loader(doc);
    this.scroller.append(this.pages, this.loader.element);
    this.pane.append(this.toolbar, this.scroller);
    container.append(this.pane);

    this.pages.addEventListener('click', (event) => void this.handleClick(event));
    this.scroller.addEventListener('scroll', () => this.scheduleStatus(), { passive: true });
    this.resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.scheduleStatus());
    this.resizeObserver?.observe(this.scroller);
    this.compiles = new LatestOnly((compile, superseded) => this.compile(compile, superseded), { interval: COMPILE_INTERVAL_MS });
    this.reveals = new LatestOnly((reveal, superseded) => this.lookUp(reveal, superseded), {
      interval: REVEAL_INTERVAL_MS,
    });
    this.highlights = new LatestOnly((highlight, superseded) => this.shade(highlight, superseded));

    this.worker.postMessage({ type: 'init', wasm: ENGINE_WASM_URL, fonts: DEFAULT_FONTS } satisfies Init);
    this.worker.onmessage = (event: MessageEvent<EngineResponse | WorkerProgress>) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.loading.apply(message.event);
        this.progressChanged();
        return;
      }
      this.pending.get(message.id)?.(message);
      this.pending.delete(message.id);
    };
    this.progressChanged();
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
    this.compiles.push(this.latest);
  }

  reveal(path: ProjectPath, { from }: SourceRange): void {
    this.reveals.push({ path, from });
  }

  clearClickHighlight(): void {
    this.clickHighlight.set([]);
  }

  setSelectionHighlight(path: ProjectPath, ranges: readonly SourceRange[], text: string): void {
    this.selection = ranges.length === 0 ? null : { path, ranges, text };
    if (this.selection) this.highlights.push(this.selection);
    else this.selectionHighlight.set([]);
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
    const { files, pages } = this.compiled;
    const compiled = files[path];
    if (typeof compiled !== 'string' || compiled.slice(range.from, range.to) !== text) return null;
    const response = await this.request({ type: 'boxes', path, ranges: [range] });
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
    const made = item(this.context);
    const entry = { made, group: placement.group, order: placement.order ?? 0 };
    // the sort is stable: equal places stay in registration order
    this.items.push(entry);
    this.items.sort(byPlacement);
    this.toolbar.append(...this.items.flatMap((each) => each.made.elements));
    this.scheduleStatus();
    return new Disposable(() => this.removeItem(made));
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

  registerViewOption(option: PreviewViewOption, options: { priority?: number } = {}): Disposable {
    if (this.registeredViewOptions.some((entry) => entry.option.id === option.id)) throw new Error(`View option '${option.id}' is already registered`);
    const entry = { option, priority: options.priority ?? 100 };
    this.registeredViewOptions.push(entry);
    this.viewChanged();
    this.viewOptionsChanged.fire();
    return new Disposable(() => {
      const index = this.registeredViewOptions.indexOf(entry);
      if (index < 0) return;
      this.registeredViewOptions.splice(index, 1);
      this.viewChanged();
      this.viewOptionsChanged.fire();
    });
  }

  viewOptions(): readonly PreviewViewOption[] {
    // the sort is stable: equal priorities stay in registration order
    return [...this.registeredViewOptions].sort((a, b) => b.priority - a.priority).map((entry) => entry.option);
  }

  setViewOptionValues(values: Readonly<Record<string, boolean>>): void {
    this.viewOptionValues = { ...values };
    this.viewChanged();
  }

  dispose(): void {
    this.rendered.dispose();
    this.diagnosed.dispose();
    this.clicked.dispose();
    this.viewOptionsChanged.dispose();
    for (const { made } of [...this.items]) this.removeItem(made);
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

  private removeItem(item: ToolbarItemElements): void {
    const index = this.items.findIndex((entry) => entry.made === item);
    if (index < 0) return;
    this.items.splice(index, 1);
    for (const element of item.elements) element.remove();
    item.dispose?.();
  }

  /** Compiles the last files again with the view options as they are now; toolbar items show the new options. */
  private viewChanged(): void {
    if (this.latest) this.compiles.push(this.latest);
    this.scheduleStatus();
  }

  private async compile({ files, main }: Compile, superseded: () => boolean): Promise<void> {
    const entry = viewEntry(this.viewOptions(), this.viewOptionValues);
    // with no prelude, the main file itself, as an export compiles it
    const compiled = entry.prelude.length === 0 ? { files, main } : { files: { ...files, [VIEW_ENTRY]: entryText(entry, main) }, main: VIEW_ENTRY };
    const response = await this.request({ type: 'compile', files: this.sender.encode(compiled.files), main: compiled.main });
    if (response.type !== 'compile') return;
    this.loading.compiled();
    const pages = this.receiver.decode(response.result.pages);
    // Keep showing the last good pages while the document has errors, dimmed as stale.
    const failed = pages.length === 0;
    if (!failed) {
      this.clickHighlight.set([]);
      this.list.render(pages);
      // the boxes of the text before until those of the new text are known (no flicker while typing)
      this.selectionHighlight.redraw();
      this.scheduleStatus();
      this.compiled = { files, pages };
      if (this.selection) this.highlights.push(this.selection);
      this.rendered.fire();
    }
    this.pages.classList.toggle('typst-preview--stale', failed);
    this.progressChanged();
    // A newer update is waiting: these diagnostics describe outdated text.
    // what goes wrong in the view options' Typst is in no project file
    if (!superseded()) this.diagnosed.fire(response.result.diagnostics.map((d) => (d.path === VIEW_ENTRY ? { ...d, path: null } : d)));
  }

  /** Shows what the preview waits for: in the pane while it has no pages, and to whoever listens. */
  private progressChanged(): void {
    const progress = this.loading.current();
    this.loader.show(this.compiled.pages.length === 0 ? progress : null);
    this.options.onDidChangeProgress?.(progress);
  }

  private async lookUp({ path, from }: Reveal, superseded: () => boolean): Promise<void> {
    const response = await this.request({ type: 'cursor', path, offset: from });
    if (superseded() || response.type !== 'cursor' || response.positions.length === 0) return;
    this.follow(response.positions[0]);
  }

  /** Shades where `highlight` is drawn, once the compiles of what was given before ran; nothing if other text is shown. */
  private async shade(highlight: Highlight, superseded: () => boolean): Promise<void> {
    await this.compiles.idle();
    const compiled = this.compiled.files[highlight.path];
    const response = compiled === highlight.text ? await this.request({ type: 'boxes', path: highlight.path, ranges: [...highlight.ranges] }) : null;
    // a newer highlight (or none) was set meanwhile
    if (superseded() || this.selection !== highlight) return;
    this.selectionHighlight.set(response?.type === 'boxes' ? response.boxes : []);
  }

  private setZoom(zoom: Zoom): void {
    const before = this.scroller.scrollTop / (this.scroller.scrollHeight || 1);
    this.zoom = zoom;
    this.list.setZoom(zoom);
    this.scroller.scrollTop = before * this.scroller.scrollHeight;
    this.updateStatus();
  }

  private visiblePage(): { index: PageIndex; count: number } {
    const rects = this.list.elements().map(measure);
    return { index: mostVisible(rects, measure(this.scroller)), count: rects.length };
  }

  /** Lets the toolbar items show the new view (zoom, page number) at most once per frame. */
  private scheduleStatus(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.updateStatus());
  }

  private updateStatus(): void {
    for (const { made } of this.items) made.update?.();
  }

  private async handleClick(event: MouseEvent): Promise<void> {
    const target = event.target as Element;
    const hit = this.list.pageAt(target);
    if (!hit) return;
    const { x, y } = pointOnPage(hit.page, measure(hit.element), Px.of(event.clientX), Px.of(event.clientY));
    const response = await this.request({ type: 'click', page: hit.index, x, y });
    if (response.type !== 'click' || response.jump?.kind !== 'source') return;
    // where the clicked source node is drawn (every line/page)
    this.clickHighlight.set(response.jump.boxes);
    const { from, to } = response.jump;
    const path = ProjectPath.parse(response.jump.path);
    // a view option's drawing (an outline) is in no project file
    if (path && path !== VIEW_ENTRY) this.clicked.fire({ path, from, to });
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
    const viewport = measure(this.scroller);
    const rect = measure(target);
    if (isInside(rect, viewport)) return;
    this.scroller.scrollBy({
      top: rect.top + rect.height / 2 - (viewport.top + viewport.height / 2),
      left: rect.left - (viewport.left + viewport.width / 2),
      behavior: 'smooth',
    });
  }

  private request(body: RequestBody): Promise<EngineResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ ...body, id });
    });
  }
}

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
  readonly onDidChangeDiagnostics: Event<readonly TypstDiagnostic[]>;
  /** After every successful compilation (snippets may have changed). */
  readonly onDidRender: Event<void>;
  /**
   * Scrolls the preview to where source range `range` of `path` is drawn (its start), only if that is off-screen;
   * nothing is marked there. Cheap to call on every cursor move: calls are throttled and only the newest is looked up.
   */
  reveal(path: ProjectPath, range: SourceRange): void;
  /**
   * Someone clicked something in the preview that has a source location in a project file (outlined in the preview
   * until the next click, a compile or `clearClickHighlight`; package files are outlined but not reported).
   */
  readonly onDidClickPage: Event<PageClick>;
  /** Removes the outline of the last click now (e.g. once the user moved on from what was clicked). */
  clearClickHighlight(): void;
  /**
   * Shades where source ranges `ranges` of `path`, which holds `text`, are drawn (glyph runs, shapes, images), in the
   * selection color; replaces the ranges set before, an empty list clears them. Drawn once a compile of `text` is
   * shown, nothing while the pages show other text; after every later compile the boxes are looked up anew. Cheap to
   * call on every selection change: only the newest ranges are looked up.
   */
  setSelectionHighlight(path: ProjectPath, ranges: readonly SourceRange[], text: string): void;
  /**
   * How source range `range` of `path`, which holds `text`, is drawn: its page cut down to it. Null when it draws
   * nothing or `text` is not what was compiled last.
   */
  snippet(path: ProjectPath, range: SourceRange, text: string): Promise<RenderedSnippet | null>;
  /** A PDF of `entry.main` from the files last compiled, `entry.sources` replacing or adding text files for it. */
  exportPdf(entry: PdfEntry): Promise<PdfResult>;
  /**
   * Offers a way to look at the document in the preview (a toggle in the View menu), until disposed. The preview
   * applies every option with its value (as `setViewOptionValues` says, else its `default`) by `priority` (default
   * 100, higher first; equal: registration order), each to what the ones before made. PDF exports never see them.
   * Throws when an option with the same `id` is registered.
   */
  registerViewOption(option: PreviewViewOption, options?: { priority?: number }): Disposable;
  /** The registered view options, in the order the preview applies them. */
  viewOptions(): readonly PreviewViewOption[];
  /** A view option was registered or disposed. */
  readonly onDidChangeViewOptions: Event<void>;
  /**
   * Which view options are on, by id (also of options registered later); the others are at their `default`. Replaces
   * the values set before and compiles again.
   */
  setViewOptionValues(values: Readonly<Record<string, boolean>>): void;
}

/** A control in the preview's toolbar: made once, for the preview it is registered with. */
export type PreviewToolbarItem = (preview: PreviewContext) => ToolbarItemElements;

/**
 * Where a toolbar item goes, as in VS Code's menus: the groups in the order of their names (the group `navigation`
 * first), so groups are named like `1_sync`, `2_view`; within a group by `order` (default 0), then registration order.
 */
export interface ToolbarPlacement {
  readonly group: string;
  readonly order?: number;
}

/** A toolbar item as made for one preview. */
export interface ToolbarItemElements {
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
  /** The page covering most of the viewport and the number of pages. */
  visiblePage(): { index: PageIndex; count: number };
}

/** A click in the preview on something with a source location: the source range of what was clicked (e.g. a text run). */
export interface PageClick extends SourceRange {
  readonly path: ProjectPath;
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

/**
 * A way to look at the document in the preview only (page guides, box outlines, comments): Typst the preview runs
 * before the main file, by the option's value. The documents and their PDF exports stay as they are.
 */
export interface PreviewViewOption {
  /** `<extension>.<name>`, e.g. `previewGuides.pageGuides`: the key in `setViewOptionValues`. */
  readonly id: string;
  /** The toggle's label ("Page guides"). */
  readonly label: string;
  /** A longer explanation, shown as the toggle's tooltip. */
  readonly description?: string;
  /** Whether it is on until someone chooses otherwise. */
  readonly default: boolean;
  /**
   * What to compile with this option set to `value`, from what the options before it made. Called for every option,
   * also when it is off; an option that changes nothing returns `entry` as it is.
   */
  apply(entry: PreviewEntry, value: boolean): PreviewEntry;
}

/**
 * What the preview compiles around the main file: `prelude`, lines of Typst markup (imports, `let`, `set` and `show`
 * rules) run before it, so each option adds its own lines. The preview compiles a file of its own holding them, which
 * then includes the main file: positions, clicks and snippets stay in the project's files. The lines must make no
 * content (a page break would come before the document).
 */
export interface PreviewEntry {
  readonly prelude: readonly string[];
}

/** Preview zoom: fit the pane width, or a fixed scale where 1 = 100 % (1 pt = 1/72 in). */
export type Zoom = 'fit' | number;

/** A cut-out of a compiled page: standalone SVG markup and its size. */
export interface RenderedSnippet {
  readonly svg: string;
  readonly width: Pt;
  readonly height: Pt;
  /** Height of its tallest box: one line of its biggest text, what an inline view scales by. */
  readonly textHeight: Pt;
  /** Space kept around what is drawn (less where the page ends). */
  readonly padding: Pt;
}

/**
 * What the preview waits for: the engine's wasm downloading (`engine`, with the bytes), the first compile
 * (`compiling`), packages or fonts downloading during a compile, or the engine that could not be loaded (`failed`).
 * The pane shows it while it has no pages; the workbench turns `failed` into an error message.
 */
export interface PreviewProgress {
  readonly kind: 'engine' | 'compiling' | 'packages' | 'fonts' | 'failed';
  /** What is going on, as people read it: "Loading the Typst compiler…", "Downloading @preview/merman 0.4.0…". */
  readonly title: string;
  /** How far, or why it failed: "3.1 / 6.6 MB"; null: nothing to add. */
  readonly detail: string | null;
  /** Done so far, from 0 to 1; null: unknown. */
  readonly fraction: number | null;
}

export interface PreviewOptions {
  /** Called whenever what the preview waits for changes (null: nothing any more). */
  onDidChangeProgress?(progress: PreviewProgress | null): void;
}

type Compile = { files: Record<string, FileContent>; main: string };
type Reveal = { path: ProjectPath; from: SourceOffset };
type Highlight = { path: ProjectPath; ranges: readonly SourceRange[]; text: string };

/** The file the preview compiles while a view option is on: their prelude, then the main file included. */
const VIEW_ENTRY = '/.typst-preview-view.typ';

/** What the view options that are on make, applied in order. */
function viewEntry(options: readonly PreviewViewOption[], values: Readonly<Record<string, boolean>>): PreviewEntry {
  let entry: PreviewEntry = { prelude: [] };
  for (const option of options) entry = option.apply(entry, values[option.id] ?? option.default);
  return entry;
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

/** Toolbar order (see `ToolbarPlacement`): the group `navigation` first, the other groups by name, then `order`. */
function byPlacement(a: { group: string; order: number }, b: { group: string; order: number }): number {
  if (a.group !== b.group) {
    if (a.group === 'navigation' || b.group === 'navigation') return a.group === 'navigation' ? -1 : 1;
    return a.group < b.group ? -1 : 1;
  }
  return a.order - b.order;
}

type RequestBody = EngineRequest extends infer R ? (R extends EngineRequest ? Omit<R, 'id'> : never) : never;
