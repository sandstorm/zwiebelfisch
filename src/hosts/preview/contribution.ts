// What a contribution to the preview is (toolbar items, PDF export options, page overlays), and what the preview
// tells it. Imports no host file above it, so contributions can name these types without importing the
// host. See preview.ts.
import type { Box } from '../../core/typst-engine/typst-engine';
import type { Zoom } from './pages/pages';

/** A control in the preview's toolbar: made once, for the preview it is registered with. */
export type PreviewToolbarItem = (preview: PreviewContext) => ToolbarItemView;

/** A toolbar item as made for one preview. */
export interface ToolbarItemView {
  /** Its elements, placed in the toolbar in this order after those of the items registered before. */
  readonly elements: readonly HTMLElement[];
  /** Called (at most once per frame) after the view changed: scrolled, resized, zoomed, new pages. */
  update?(): void;
  /** Called when the item is unregistered or the preview destroyed; the toolbar removes `elements`. */
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
  /** Whether `Preview.reveal` scrolls to the place asked for ("Follow cursor"); default true. */
  isFollowing(): boolean;
  /** Switches following on or off; switching it on goes to the newest place asked for. */
  setFollowing(on: boolean): void;
}

/**
 * What a PDF compiles: an entry file and source texts that replace (or add to) the project's `.typ` files for this
 * export only; the documents stay as they are. The export starts from the main file and no sources.
 */
export interface PdfEntry {
  readonly main: string;
  readonly sources: Readonly<Record<string, string>>;
}

/**
 * A choice offered when exporting a PDF (a checkbox next to "Download"; `exportPdf({ options })` for hosts), e.g.
 * whether the PDF includes the comments. Each option changes what is compiled, never the documents. Options are
 * checkboxes for now; a later `choices?: { value, label }[]` would make `default` and `value` one of them.
 */
export interface PdfExportOption {
  /** `<extension>.<name>`, e.g. `comments.include`: the key in `exportPdf({ options })` and in what is remembered. */
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
 * Marks drawn over the pages (`Preview.createOverlay`), each a box in points on its page, kept in place at
 * any zoom and through lazy rendering and recompiles, until set again or disposed.
 */
export interface PageOverlay {
  /** Replaces the boxes shown. */
  set(boxes: readonly Box[]): void;
  /** Removes the boxes, for good. */
  dispose(): void;
}
