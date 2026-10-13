// HtmlView: the HTML bundle's pages in a sandboxed frame, one at a time. See previewHtml in ../preview-html.ts.
import { HTML_ELEMENT_ATTRIBUTE, type ElementLocation, type HtmlFile } from '../../../core/typst-engine/typst-engine';
import type { HtmlBundle, PreviewRendererView } from '../../../hosts/preview/preview';
import { type LinkTarget, linkTarget, pageForCursor } from '../model/bundle';
import { BundleAssets } from './assets';
import { morphDocument } from './morph';

/**
 * One page of the bundle in an `<iframe sandbox="allow-same-origin">`: its own styles apply, its scripts do not run.
 * A new compile changes the shown page in place (`morphDocument`), so it keeps its scroll position. A click on a link
 * to another page of the bundle shows that page here; one to a URL opens a new tab. The cursor (`reveal`) shows the
 * page holding the element its text produced and scrolls that element into view.
 */
export class HtmlView implements PreviewRendererView {
  private readonly frame: HTMLIFrameElement;
  private readonly assets: BundleAssets;
  private files = new Map<string, HtmlFile>();
  /** The bundle path of the page shown; null before the first compile. */
  private page: string | null = null;
  /** What is shown: the page and the files' hashes; null: nothing yet. */
  private rendered: string | null = null;
  /** Where to scroll once the frame is ready (an element by its mark, or an id); null: nowhere. */
  private pendingScroll: Scroll | null = null;
  /** The frame's document that loaded last. */
  private loaded: Document | null = null;

  /**
   * `projectFile(path)`: the data of a project file at a bundle path the bundle has no file for (a font a style sheet
   * loads, as the build of a static site copies them next to the pages); null if there is none. The same array while
   * the file stays the same.
   */
  constructor(
    container: HTMLElement,
    private readonly projectFile: (path: string) => Uint8Array | null,
  ) {
    const doc = container.ownerDocument;
    this.frame = doc.createElement('iframe');
    this.frame.className = 'typst-preview-html__frame';
    this.frame.dataset.testid = 'typst-preview-html';
    this.frame.title = 'HTML preview';
    // its DOM is ours to change (same origin); its scripts and forms stay off
    this.frame.setAttribute('sandbox', 'allow-same-origin');
    this.frame.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';
    // the empty page is ready: show what came meanwhile
    this.frame.addEventListener('load', () => this.frameLoaded());
    container.append(this.frame);
    this.assets = new BundleAssets((path) => {
      const file = this.files.get(path);
      if (file) return { data: file.data, version: file.hash };
      const data = this.projectFile(path);
      return data && { data, version: data };
    });
  }

  update({ files }: HtmlBundle): void {
    this.files = new Map(files.map((file) => [file.path, file]));
    if (this.page === null || !this.files.get(this.page)?.document) this.page = files.find((file) => file.document)?.path ?? null;
    this.render();
  }

  reveal(elements: readonly ElementLocation[]): void {
    const target = pageForCursor(this.page, elements);
    if (!target) return;
    this.show(target.path, target.element === null ? null : { kind: 'element', id: target.element });
  }

  dispose(): void {
    this.assets.dispose();
    this.frame.remove();
  }

  /** Shows bundle page `path`, scrolled to `scroll` (none: the top of a page switched to, where it was on the same). */
  private show(path: string, scroll: Scroll | null): void {
    const switched = path !== this.page;
    this.page = path;
    this.pendingScroll = scroll ?? (switched ? { kind: 'top' } : null);
    this.render();
  }

  private render(): void {
    const doc = this.frameDocument();
    const file = this.page === null ? undefined : this.files.get(this.page);
    if (!doc || !file) return;
    const state = `${file.path} ${[...this.files.values()].map((f) => f.hash).join()}`;
    if (state !== this.rendered) {
      const parsed = new DOMParser().parseFromString(new TextDecoder().decode(file.data), 'text/html');
      this.assets.rewritePage(parsed, file.path);
      morphDocument(doc, parsed);
      this.rendered = state;
    }
    if (this.pendingScroll) scrollTo(doc, this.pendingScroll);
    this.pendingScroll = null;
  }

  /** The frame's document, once it loaded (it then listens to clicks on links). */
  private frameDocument(): Document | null {
    const doc = this.frame.contentDocument;
    return doc && doc === this.loaded ? doc : null;
  }

  /**
   * The frame loaded a document: the empty page of `srcdoc`, or before it the frame's first `about:blank` (some
   * browsers tell that one, too): what is shown goes into it, and again into the next.
   */
  private frameLoaded(): void {
    const doc = this.frame.contentDocument;
    if (!doc || doc === this.loaded) return;
    this.loaded = doc;
    doc.addEventListener('click', (event) => this.clicked(event));
    this.rendered = null;
    this.render();
  }

  private clicked(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!link || this.page === null) return;
    // nothing navigates the frame: the page stays ours
    event.preventDefault();
    const documents = new Map([...this.files.values()].map((file) => [file.path, file.document]));
    this.follow(linkTarget(this.page, link.getAttribute('href')!, documents));
  }

  /** A page of the bundle here; a URL or another file of the bundle in a new tab. */
  private follow(target: LinkTarget): void {
    const open = (url: string) => this.frame.ownerDocument.defaultView?.open(url, '_blank', 'noopener,noreferrer');
    if (target.kind === 'page') this.show(target.path, target.fragment === null ? null : { kind: 'id', id: target.fragment });
    else if (target.kind === 'external') open(target.url);
    else if (target.kind === 'file') open(URL.createObjectURL(new Blob([this.files.get(target.path)!.data as BlobPart])));
  }
}

/**
 * Where a page is scrolled to: its top, the element with an id (a link's `#…`) at the top, or the element marked as
 * the cursor's into the middle unless it is visible.
 */
type Scroll = { kind: 'top' } | { kind: 'id'; id: string } | { kind: 'element'; id: string };

/** Scrolls the frame's own page (`scrollIntoView` would scroll the pages around the frame, too). */
function scrollTo(doc: Document, scroll: Scroll): void {
  const view = doc.defaultView;
  if (!view) return;
  if (scroll.kind === 'top') return view.scrollTo(0, 0);
  const rect = scrollTarget(doc, scroll)?.getBoundingClientRect();
  if (!rect) return;
  if (scroll.kind === 'id') return view.scrollTo({ top: view.scrollY + rect.top });
  const visible = rect.top >= 0 && rect.bottom <= view.innerHeight;
  if (!visible) view.scrollTo({ top: view.scrollY + rect.top + rect.height / 2 - view.innerHeight / 2, behavior: 'smooth' });
}

function scrollTarget(doc: Document, scroll: Exclude<Scroll, { kind: 'top' }>): Element | null {
  if (scroll.kind === 'id') return doc.getElementById(scroll.id);
  return doc.querySelector(`[${HTML_ELEMENT_ATTRIBUTE}="${scroll.id.replace(/["\\]/g, '\\$&')}"]`);
}
