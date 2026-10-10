import type { Node } from '@tiptap/pm/model';
import { imagePath } from './projection';

/** A picture of compiled Typst: standalone SVG markup and its size in points. */
export interface Snippet {
  svg: string;
  width: number;
  height: number;
}

/**
 * What raw boxes show instead of their code while they are not being edited.
 * The host provides it (the widget: from the preview's compiled pages and the
 * project files).
 */
export interface BoxRenderer {
  /**
   * How source `from`..`to` of the document, which holds `text`, looks
   * compiled; null when it draws nothing or cannot be shown right now.
   */
  snippet(from: number, to: number, text: string): Promise<Snippet | null>;
  /** A URL of the image file `path` (as written in `#image(..)`), or null if there is none. */
  imageUrl(path: string): string | null;
  /** Calls `listener` whenever snippets or images may have changed. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** Code that configures or defines (`#set`, `#let`, …) and draws nothing in place, or only elsewhere. */
const NOT_IN_PLACE = /^\s*(#(set|show|let|import|include)\b|\/\/|\/\*)/;

/** Whether `src` (a raw box's Typst) draws its own output where it stands, so a snippet of it is meaningful. */
export function rendersInPlace(src: string): boolean {
  return !NOT_IN_PLACE.test(src);
}

/** The raw box a `RenderedBox` belongs to. */
export interface BoxHost {
  /** The box's element; the picture goes in before `code`. */
  dom: HTMLElement;
  /** The element holding the code editor. */
  code: HTMLElement;
  /** The box's node and where its source starts, or null while it is not in the document. */
  source(): { node: Node; from: number } | null;
  /** Focuses the code (the picture was clicked). */
  activate(): void;
}

/**
 * The rendered face of a raw box: an image file (for `image` nodes) or the
 * compiled snippet of its source, shown instead of the code while the box
 * does not have focus. Clicking the picture hands focus to the code.
 *
 * Owns the `<img>`, the switching between it and the code, and the refreshes: images follow the node at once,
 * snippets whenever the renderer reports a change.
 */
export class RenderedBox {
  private readonly picture: HTMLImageElement;
  private readonly unsubscribe: () => void;
  private url: string | null = null;
  private editing = false;
  private requests = 0;

  constructor(
    private readonly host: BoxHost,
    private readonly renderer: BoxRenderer,
  ) {
    const { dom, code } = host;
    this.picture = dom.ownerDocument.createElement('img');
    this.picture.className = 'typst-visual__rendering';
    this.picture.alt = '';
    this.picture.hidden = true;
    this.picture.addEventListener('mousedown', (event) => {
      event.preventDefault();
      host.activate();
    });
    dom.insertBefore(this.picture, code);
    dom.addEventListener('focusin', () => this.setEditing(true));
    dom.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as globalThis.Node | null;
      if (!next || !dom.contains(next)) this.setEditing(false);
    });
    this.unsubscribe = renderer.onChange(() => void this.refresh());
    // Positions are only known once the node view is in place.
    queueMicrotask(() => void this.refresh());
  }

  /** Shows the code, e.g. right before it gets focus. */
  edit(): void {
    this.setEditing(true);
  }

  /** The node changed: an image follows its path at once; snippets wait for the next change of the renderer. */
  update(node: Node): void {
    if (node.type.name === 'image') void this.refresh();
  }

  destroy(): void {
    this.unsubscribe();
    this.requests++;
  }

  private async refresh(): Promise<void> {
    const request = ++this.requests;
    const source = this.host.source();
    if (!source) return;
    const picture = await this.render(source);
    if (request !== this.requests) return;
    this.url = picture?.url ?? null;
    if (picture) {
      if (this.picture.getAttribute('src') !== picture.url) this.picture.src = picture.url;
      this.picture.style.width = picture.width === undefined ? '' : `${picture.width}pt`;
      this.picture.alt = source.node.attrs.src;
    }
    this.show();
  }

  private async render({ node, from }: { node: Node; from: number }): Promise<{ url: string; width?: number } | null> {
    const src: string = node.attrs.src;
    if (node.type.name === 'image') {
      const path = imagePath(src);
      const url = path === null ? null : this.renderer.imageUrl(path);
      return url === null ? null : { url };
    }
    if (!rendersInPlace(src)) return null;
    const snippet = await this.renderer.snippet(from, from + src.length, src);
    return snippet && { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(snippet.svg)}`, width: snippet.width };
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    this.show();
  }

  private show(): void {
    const rendered = this.url !== null && !this.editing;
    this.picture.hidden = !rendered;
    this.host.code.hidden = rendered;
    this.host.dom.classList.toggle('typst-visual__raw--rendered', rendered);
  }
}
