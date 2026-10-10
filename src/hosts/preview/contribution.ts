// What a contribution to the preview is (toolbar items, PDF variants, page overlays), and what the preview
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
  /** The registered PDF variants, in the order of registration. */
  pdfVariants(): readonly PdfVariant[];
}

/** A click in the preview on something with a source location: the source range of what was clicked (e.g. a text run). */
export interface PageClick {
  /** The file, as the engine names it (a project path, or a package file). */
  readonly path: string;
  readonly from: number;
  readonly to: number;
}

/** A PDF the preview offers to download, e.g. "Without comments" / "With comments". */
export interface PdfVariant {
  /** How menus name it ("With comments"). */
  readonly label: string;
  /** Makes the PDF. Rejects with an error whose message is shown to the user. */
  create(): Promise<PdfFile>;
}

/** A PDF to save: the file and the name to save it under. */
export interface PdfFile {
  blob: Blob;
  name: string;
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
