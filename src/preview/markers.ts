import type { Position } from '../engine/engine';

/** A mark in the page margin next to where the source at `offset` of `path` appears. */
export interface Marker {
  path: string;
  offset: number;
  className: string;
  /** Set on the marker element, e.g. `data-comment-id`, so clicks can be traced back. */
  attributes?: Record<string, string>;
  /** Tooltip. */
  title?: string;
}

export interface MarkerPages {
  /** Where the source at `offset` appears in the last compiled document. */
  locate(path: string, offset: number): Promise<Position[]>;
  /** The element and size (pt) of page `index`, if it exists. */
  page(index: number): { element: HTMLElement; page: { width: number; height: number } } | null;
}

/**
 * Margin markers on the preview pages, by layer (one per feature). Each
 * layer is replaced as a whole; `refresh()` places all of them again after a
 * compilation moved the text. Markers are page children positioned in
 * percent, so they survive zoom and lazy page rendering.
 */
export class PreviewMarkers {
  private readonly layers = new Map<string, { markers: readonly Marker[]; elements: HTMLElement[]; generation: number }>();

  constructor(private readonly pages: MarkerPages) {}

  set(layer: string, markers: readonly Marker[]): void {
    const entry = this.layers.get(layer) ?? { markers, elements: [], generation: 0 };
    entry.markers = markers;
    this.layers.set(layer, entry);
    void this.place(layer);
  }

  /** Places every layer again (after a compilation). */
  refresh(): Promise<void> {
    return Promise.all([...this.layers.keys()].map((layer) => this.place(layer))).then(() => {});
  }

  /** Whether `target` is (inside) a marker rather than page content. */
  static isMarker(target: Element): boolean {
    return target.closest('[data-preview-marker]') !== null;
  }

  destroy(): void {
    for (const entry of this.layers.values()) for (const element of entry.elements) element.remove();
    this.layers.clear();
  }

  /** Looks up where the layer's markers belong and replaces its elements, unless a newer placement started meanwhile. */
  private async place(layer: string): Promise<void> {
    const entry = this.layers.get(layer)!;
    const generation = ++entry.generation;
    const positions = await Promise.all(entry.markers.map((marker) => this.pages.locate(marker.path, marker.offset)));
    if (generation !== entry.generation) return;
    for (const element of entry.elements) element.remove();
    entry.elements = entry.markers.flatMap((marker, index) => {
      const element = positions[index][0] && this.create(marker, positions[index][0]);
      return element ? [element] : [];
    });
  }

  private create(marker: Marker, { page, y }: Position): HTMLElement | null {
    const hit = this.pages.page(page);
    if (!hit) return null;
    const element = hit.element.ownerDocument.createElement('div');
    element.className = `typst-preview__marker ${marker.className}`;
    element.dataset.previewMarker = '';
    element.style.top = `${(y / hit.page.height) * 100}%`;
    if (marker.title) element.title = marker.title;
    for (const [name, value] of Object.entries(marker.attributes ?? {})) element.setAttribute(name, value);
    hit.element.append(element);
    return element;
  }
}
