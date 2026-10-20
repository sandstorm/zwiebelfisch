// RenderedBox: a raw box shown as a picture (from a box renderer) while it is not edited. See rawBoxes in
// raw-box.ts.
import type { Node } from '@tiptap/pm/model';
import type { Disposable } from '../../../core/disposable/disposable';
import type { SourceOffset } from '../../../core/typst-document/typst-document';
import type { RawBoxPicture, RawBoxRenderer } from '../visual-editor';

/**
 * The rendered face of a raw box: its renderer's picture, shown instead of the code while the box does not have focus.
 *
 * Clicking the picture activates the box, unless a raw box extension stopped the click. Until the renderer has a
 * picture the box shows its code, and a new picture is decoded before it replaces what was shown, so the box never
 * shows a blank picture. Only boxes near the view (one viewport above and below) are redrawn
 * when the renderer changes; the others once they come near.
 *
 * @internal Extensions draw it through `visualEditor.registerRawBoxRenderer`.
 */
export class RenderedBox {
  /** The `<img>` shown instead of the code (an extension may move it, e.g. into a frame). */
  private readonly picture: HTMLImageElement;
  private readonly subscription: Disposable;
  private url: string | null = null;
  private editing = false;
  private requests = 0;
  /** Whether the box is near the view (without an IntersectionObserver, as in jsdom: always). */
  private near = true;
  /** The renderer changed while the box was not near: it is drawn again once it is. */
  private stale = false;
  private readonly observer: IntersectionObserver | null;

  constructor(
    private readonly host: BoxHost,
    private readonly renderer: RawBoxRenderer,
  ) {
    const { dom, code } = host;
    this.picture = dom.ownerDocument.createElement('img');
    this.picture.className = 'zwf-visual__rendering';
    if (renderer.className) this.picture.classList.add(renderer.className);
    this.picture.alt = '';
    this.picture.hidden = true;
    dom.insertBefore(this.picture, code);
    // the extensions' listeners first: they may stop a click
    host.extend(this.picture);
    this.picture.addEventListener('mousedown', (event) => {
      event.preventDefault();
      host.activate();
    });
    code.addEventListener('focusin', () => this.setEditing(true));
    code.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as globalThis.Node | null;
      if (!next || !code.contains(next)) this.setEditing(false);
    });
    this.subscription = renderer.onDidChange(() => this.changed());
    const view = dom.ownerDocument.defaultView;
    this.observer = view?.IntersectionObserver ? new view.IntersectionObserver(([entry]) => this.setNear(entry.isIntersecting), { rootMargin: '100% 0px' }) : null;
    this.observer?.observe(dom);
    // Positions are only known once the node view is in place.
    queueMicrotask(() => void this.refresh());
  }

  /** Shows the code, e.g. right before it gets focus. */
  edit(): void {
    this.setEditing(true);
  }

  /** The node changed: drawn again at once if the renderer follows edits (an image its path), else on its next change. */
  update(): void {
    if (this.renderer.followsEdits) void this.refresh();
  }

  dispose(): void {
    this.subscription.dispose();
    this.observer?.disconnect();
    this.requests++;
  }

  private changed(): void {
    if (this.near) void this.refresh();
    else this.stale = true;
  }

  private setNear(near: boolean): void {
    this.near = near;
    if (!near || !this.stale) return;
    this.stale = false;
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const request = ++this.requests;
    const source = this.host.source();
    if (!source) return;
    const picture = await this.renderer.render(source.node, source.from);
    if (picture && picture.url !== this.picture.getAttribute('src')) await decoded(this.picture.ownerDocument, picture.url);
    if (request !== this.requests) return;
    this.url = picture?.url ?? null;
    if (picture) this.show(picture, source.node.attrs.src);
    this.toggle();
  }

  private show(picture: RawBoxPicture, src: string): void {
    if (this.picture.getAttribute('src') !== picture.url) this.picture.src = picture.url;
    const { style } = this.picture;
    style.width = picture.width ?? '';
    style.height = picture.height ?? '';
    style.marginTop = style.marginBottom = picture.margin ?? '';
    this.picture.alt = src;
  }

  private setEditing(editing: boolean): void {
    this.editing = editing;
    this.toggle();
  }

  private toggle(): void {
    const rendered = this.url !== null && !this.editing;
    this.picture.hidden = !rendered;
    this.host.code.hidden = rendered;
    this.host.dom.classList.toggle('zwf-visual__raw--rendered', rendered);
  }
}

/** The raw box a `RenderedBox` belongs to. */
export interface BoxHost {
  /** The box's element; the picture goes in before `code`. */
  dom: HTMLElement;
  /** The element holding the code editor. */
  code: HTMLElement;
  /** The box's node and where its source starts, or null while it is not in the document. */
  source(): { node: Node; from: SourceOffset } | null;
  /** The picture was clicked (focus the code, or select the box). */
  activate(): void;
  /** Adds what the raw box extensions do to the box, its picture `picture` (in place, before the box's own listeners). */
  extend(picture: HTMLImageElement): void;
}

/** Once the image at `url` is decoded (or failed to; then the box shows it as the browser does), where the browser can tell. */
async function decoded(doc: Document, url: string): Promise<void> {
  const image = doc.createElement('img');
  image.src = url;
  if (typeof image.decode === 'function') await image.decode().catch(() => {});
}
