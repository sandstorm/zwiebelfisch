import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { ElementLocation, HtmlFile, TypstDiagnostic, PageIndex, PdfEntry, PdfResult, Pt } from '../../core/typst-engine/typst-engine';

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
   * Someone clicked something in the preview that has a source location in a project file (outlined in the preview
   * until the next click, a compile or `clearClickHighlight`; package files are outlined but not reported).
   */
  readonly onDidClickPage: Event<PageClick>;
  /** Removes the outline of the last click now (e.g. once the user moved on from what was clicked). */
  clearClickHighlight(): void;
  /**
   * The bytes of memory the engine (its wasm, in the worker) held after the last compile; 0 before the first. It
   * grows and never shrinks, up to 4 GiB, where the engine crashes and the preview starts a new one. For looking at
   * it (devtools); nothing needs to act on it.
   */
  readonly engineMemory: number;
  /** `engineMemory` changed: after a compile that made the engine grow, or the first of a new engine. */
  readonly onDidChangeEngineMemory: Event<void>;
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
  /**
   * Shown only while this renderer is active (zoom and page number: `pages`), by the elements' `hidden`; none: always
   * (an item may then hide its elements itself).
   */
  readonly renderer?: string;
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
  /** Its name in a switch ("HTML"). */
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
 * What the preview waits for: the engine's wasm downloading (`engine`, with the bytes), the first compile
 * (`compiling`), packages or fonts downloading during a compile, or the engine that could not be loaded or crashed
 * (`failed`). The pane shows it while it has no pages; the workbench turns `failed` into an error message.
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

export { Preview } from './preview-impl';
