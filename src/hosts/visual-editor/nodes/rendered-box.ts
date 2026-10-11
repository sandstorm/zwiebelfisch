// RenderedBox: a raw box shown as a picture (from a box renderer) while it is not edited. See rawBoxViews in
// raw-box.ts.
import type { Node } from '@tiptap/pm/model';
import type { Disposable } from '../../../core/disposable/disposable';
import type { SourceOffset } from '../../../core/typst-document/typst-document';
import type { RawBoxLink, RawBoxPicture, RawBoxRenderer } from '../visual-editor';

/**
 * The rendered face of a raw box: its renderer's picture, shown instead of
 * the code while the box does not have focus. Clicking the picture activates
 * the box; it leads where the box links to, as a link in text does: hovered,
 * it says where in its tooltip, shows as a link (`--link`) while the modifier
 * is held, and Mod+click follows it. Until the renderer has a picture (the
 * preview's first compile), the box shows its code; a picture is decoded
 * before it replaces the code or the picture before it, so the box never shows
 * a blank picture in between.
 *
 * Owns the `<img>`, the switching between it and the code, and the refreshes:
 * whenever the renderer reports a change and, for renderers that follow
 * edits, whenever the node changes.
 */
export class RenderedBox {
  /** The `<img>` shown instead of the code (the box's tools may move it, e.g. into a frame). */
  readonly picture: HTMLImageElement;
  private readonly subscription: Disposable;
  private url: string | null = null;
  private editing = false;
  private requests = 0;
  /** Ends the hover (the mouse left, or the box goes). */
  private leave = () => {};

  constructor(
    private readonly host: BoxHost,
    private readonly renderer: RawBoxRenderer,
  ) {
    const { dom, code } = host;
    this.picture = dom.ownerDocument.createElement('img');
    this.picture.className = 'typst-visual__rendering';
    if (renderer.className) this.picture.classList.add(renderer.className);
    this.picture.alt = '';
    this.picture.hidden = true;
    this.picture.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const link = event.button === 0 ? host.link() : null;
      if (link?.isFollowEvent(event)) link.follow();
      else host.activate();
    });
    this.followLinkOnHover();
    dom.insertBefore(this.picture, code);
    code.addEventListener('focusin', () => this.setEditing(true));
    code.addEventListener('focusout', (event) => {
      const next = event.relatedTarget as globalThis.Node | null;
      if (!next || !code.contains(next)) this.setEditing(false);
    });
    this.subscription = renderer.onDidChange(() => void this.refresh());
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
    this.leave();
    this.requests++;
  }

  /**
   * While hovered: the link's tooltip, and the link look while the modifier is held (also when it is pressed or let go
   * without moving the mouse: the keys go to the document).
   */
  private followLinkOnHover(): void {
    const picture = this.picture;
    const doc = picture.ownerDocument;
    let link: RawBoxLink | null = null;
    const track = (event: MouseEvent | KeyboardEvent) => picture.classList.toggle('typst-visual__rendering--link', link?.isFollowEvent(event) ?? false);
    picture.addEventListener('mouseenter', (event) => {
      link = this.host.link();
      picture.title = link?.title ?? '';
      track(event);
      doc.addEventListener('keydown', track);
      doc.addEventListener('keyup', track);
    });
    picture.addEventListener('mousemove', track);
    this.leave = () => {
      link = null;
      picture.classList.remove('typst-visual__rendering--link');
      doc.removeEventListener('keydown', track);
      doc.removeEventListener('keyup', track);
    };
    picture.addEventListener('mouseleave', () => this.leave());
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
    this.host.dom.classList.toggle('typst-visual__raw--rendered', rendered);
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
  /** Where the box leads now, or nowhere. */
  link(): RawBoxLink | null;
}

/** Once the image at `url` is decoded (or failed to; then the box shows it as the browser does), where the browser can tell. */
async function decoded(doc: Document, url: string): Promise<void> {
  const image = doc.createElement('img');
  image.src = url;
  if (typeof image.decode === 'function') await image.decode().catch(() => {});
}
