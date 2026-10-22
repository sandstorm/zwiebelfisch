import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { ElementLocation, HtmlFile, TypstDiagnostic, PageIndex, PageRect, PdfEntry, PdfResult, Pt } from '../../core/typst-engine/typst-engine';

/**
 * The preview as extensions see it (`ExtensionContext.preview`): its contribution points, its view, and what its
 * engine answers about the project it compiles.
 *
 * Its toolbar shows the menu `preview/toolbar` (as VS Code's `window/editorTitle`; `window.registerMenuItem`): a button per
 * entry, in groups (the built-ins: `1_sync` "Follow cursor", `2_view` the renderers and zoom, `3_export` "Download
 * PDF", at the row's end). Its context and its commands' argument is a `PreviewMenuContext`.
 */
export interface PreviewContributions {
  /**
   * Offers a choice for PDF exports (a checkbox), until disposed. An export applies every option, in registration
   * order, each to what the ones before it made. Throws when an option with the same `id` is registered.
   */
  registerPdfExportOption(option: PdfExportOption): Disposable;
  /**
   * Adds a way to show the document instead of its pages, until disposed; `setActiveRenderer` chooses which is shown.
   * Throws when a renderer with the same `id` is registered (`pages` is the built-in one's).
   */
  registerRenderer(renderer: PreviewRenderer): Disposable;
  /** The built-in pages (`pages`, first) and the registered renderers, in registration order. */
  renderers(): readonly PreviewRendererInfo[];
  /** The id of the renderer shown: the one `setActiveRenderer` asked for while it is registered, else `pages`. */
  readonly activeRenderer: string;
  /**
   * Shows the renderer `id` (also one registered later; until then, and once it is disposed, the pages), and compiles
   * what it shows.
   */
  setActiveRenderer(id: string): void;
  /** A renderer was registered or disposed, or the active one changed. */
  readonly onDidChangeRenderers: Event<void>;
  /** How the pages are zoomed. */
  readonly zoom: Zoom;
  /** Zooms the pages, keeping the part of the document shown (relatively) where it was. */
  setZoom(zoom: Zoom): void;
  /** The scale of the first page (1 = 100 %), also when fitting the width. */
  readonly scale: number;
  /** The page covering most of the viewport, and the number of pages. */
  readonly visiblePage: VisiblePage;
  /** The pages were scrolled, resized, zoomed or shown anew (`zoom`, `scale`, `visiblePage`); at most once per frame. */
  readonly onDidChangeView: Event<void>;
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
   * Another renderer than the pages gets the elements the start produced (`PreviewRendererView.reveal`).
   */
  reveal(path: ProjectPath, range: SourceRange): void;
  /**
   * Someone clicked something in the preview that has a source location in a project file (clicks on package files
   * are not reported). Nothing is marked: the boxes it gives are for a `createPageOverlay`.
   */
  readonly onDidClickPage: Event<PageClick>;
  /**
   * The bytes of memory the engine (its wasm, in the worker) held after the last compile; 0 before the first. It
   * grows and never shrinks, up to 4 GiB, where the engine crashes and the preview starts a new one. For looking at
   * it (devtools); nothing needs to act on it.
   */
  readonly engineMemory: number;
  /** `engineMemory` changed: after a compile that made the engine grow, or the first of a new engine. */
  readonly onDidChangeEngineMemory: Event<void>;
  /**
   * How loading the engine goes, as it happens (not repeated for a late listener: until told otherwise, the first
   * engine is loading). For a loading note (preview-progress); nothing needs it to compile.
   */
  readonly onDidLoad: Event<LoadEvent>;
  /** The engine crashed; the preview restarts it once per `update()` by itself. */
  readonly onDidCrash: Event<EngineCrash>;
  /**
   * Whether the pane shows nothing of the document yet: no pages, or the active renderer got no output. It changes
   * only before `onDidRender` and `onDidChangeRenderers`.
   */
  readonly isEmpty: boolean;
  /**
   * Lays `element` over the pane below the toolbar (on top of the pages or renderer), until disposed; the preview
   * removes it then. The caller's CSS places it: the pane's scroll area is `position: relative`, so
   * `position: absolute; inset: 0` covers it. Without any, the pane shows nothing while it loads.
   */
  registerPaneOverlay(element: HTMLElement): Disposable;
  /**
   * Draws boxes over the pages as elements of class `className` (the caller's CSS styles them; the preview places
   * them in percent of their page, so they keep their place at any zoom), until disposed. The boxes set stay through
   * compiles: after every render they are drawn on the new pages, until `set` replaces them.
   */
  createPageOverlay(className: string): PageOverlay;
  /**
   * Where source ranges `ranges` of `path`, which holds `text`, are drawn (glyph runs, shapes, images), on the pages,
   * once the compiles of the files given before ran. Empty when they draw nothing or the pages show other text than
   * `text` (it was edited since, or the document has errors).
   */
  boxesFor(path: ProjectPath, ranges: readonly SourceRange[], text: string): Promise<readonly PageRect[]>;
  /**
   * How source range `range` of `path`, which holds `text`, is drawn: its page cut down to it. Null when it draws
   * nothing or `text` is not what was compiled last.
   */
  snippet(path: ProjectPath, range: SourceRange, text: string): Promise<RenderedSnippet | null>;
  /** A PDF of `entry.main` from the files last compiled, `entry.sources` replacing or adding text files for it. */
  exportPdf(entry: PdfEntry): Promise<PdfResult>;
  /**
   * Offers a way to look at the document in the preview (a toggle in the View menu), until disposed. The preview
   * applies every option with its value (as `setViewOptionValues` says, else its `default`) in registration order,
   * each to what the ones before made. PDF exports never see them. Throws when an option with the same `id` is
   * registered.
   */
  registerViewOption(option: PreviewViewOption): Disposable;
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

/** What the menu `preview/toolbar` is shown with, and what its commands get. */
export interface PreviewMenuContext {
  /** The id of the renderer shown (`activeRenderer`): `pages`, `html`, … */
  readonly previewRenderer: string;
}

/** The page covering most of the preview's viewport, and the number of pages (0: none). */
export interface VisiblePage {
  readonly index: PageIndex;
  readonly count: number;
}

/**
 * A way to show the document in the preview instead of its pages (the HTML preview): it gets what the engine makes
 * for it, and shows it in a container of its own. The preview compiles only for the active renderer.
 */
export interface PreviewRenderer extends PreviewRendererInfo {
  /** What the engine makes for it: `html`, the files of Typst's HTML bundle export. */
  readonly output: 'html';
  /** Makes its view in `container` (filling the preview below the toolbar) when it becomes the active renderer. */
  create(container: HTMLElement): PreviewRendererView;
}

/** A renderer as the preview lists it. */
export interface PreviewRendererInfo {
  /** The key in `setActiveRenderer`, e.g. `html`; `pages` is the built-in pages'. */
  readonly id: string;
  /** Its name, on its button in the toolbar ("HTML"). */
  readonly label: string;
}

/** A renderer's view while it is the active one. */
export interface PreviewRendererView {
  /** Shows what a successful compile made (a failed compile keeps the last, dimmed). */
  update(output: HtmlBundle): void;
  /**
   * The cursor moved (`reveal`): the elements its text produced, the first of each document, in bundle order. Empty:
   * none (a `#let`, a comment, or the last compile failed).
   */
  reveal?(elements: readonly ElementLocation[]): void;
  /** It is no longer the active renderer, or the preview closes; the preview removes the container. */
  dispose(): void;
}

/**
 * What Typst's HTML bundle export makes: HTML documents and their assets. Every element made from source carries
 * `HTML_ELEMENT_ATTRIBUTE` (core/typst-engine), which `ElementLocation.element` names.
 */
export interface HtmlBundle {
  readonly files: readonly HtmlFile[];
}

/** A click in the preview on something with a source location: the source range of what was clicked (e.g. a text run). */
export interface PageClick extends SourceRange {
  readonly path: ProjectPath;
  /** Where the clicked source is drawn: one box per line and page; empty for what is not text. */
  readonly boxes: readonly PageRect[];
}

/** Boxes drawn over the preview's pages (`PreviewContributions.createPageOverlay`), as elements of one class. */
export interface PageOverlay {
  /** Draws `boxes` (in pt) instead of the ones set before; an empty list clears them. */
  set(boxes: readonly PageRect[]): void;
  /** Removes the boxes; the overlay draws nothing any more. */
  dispose(): void;
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
  /** The compiles it applies to (default: the pages); `entry.output` tells which one `apply` is called for. */
  readonly outputs?: readonly PreviewOutput[];
  /**
   * What to compile with this option set to `value`, from what the options before it made. Called for every option
   * of the output, also when it is off; an option that changes nothing returns `entry` as it is.
   */
  apply(entry: PreviewEntry, value: boolean): PreviewEntry;
}

/** What a preview compile makes: the pages, or Typst's HTML export for a renderer. */
export type PreviewOutput = 'pages' | 'html';

/**
 * What the preview compiles around the main file: `prelude`, lines of Typst markup (imports, `let`, `set` and `show`
 * rules) run before it, so each option adds its own lines. The preview compiles a file of its own holding them, which
 * then includes the main file: positions, clicks and snippets stay in the project's files. The lines must make no
 * content (a page break would come before the document).
 */
export interface PreviewEntry {
  /** The compile it is for. */
  readonly output: PreviewOutput;
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
 * How loading the engine goes (`PreviewContributions.onDidLoad`): a new engine starts after a crash (the first one
 * loads from the start, untold), its wasm downloads (`loaded` of `total` bytes; null: unknown), it is ready or
 * could not be loaded (then every compile fails), and packages or fonts download during a compile.
 */
export type LoadEvent =
  | { kind: 'starting' }
  | { kind: 'engine'; loaded: number; total: number | null }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }
  /** The packages (`@preview/name:version`) downloading now; empty: none any more. */
  | { kind: 'packages'; specs: readonly string[] }
  /** A font file downloading (its name), or none any more (null). */
  | { kind: 'font'; name: string | null };

/** The engine crashed (`message` says why); `restarting`: a new one starts now, else it stays off until the next `update()`. */
export interface EngineCrash {
  readonly message: string;
  readonly restarting: boolean;
}

export { Preview } from './preview-impl';
