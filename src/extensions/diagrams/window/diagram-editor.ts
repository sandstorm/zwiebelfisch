// A diagram in diagrams.net's editor, embedded in an iframe. See diagrams in ../diagrams.ts.
import { ProjectPath } from '../../../core/paths/paths';
import { EmbedSession, embedUrl, type EmbedAction } from '../model/embed-session';

/**
 * The diagram `path` in diagrams.net's embedded editor (embed mode, JSON protocol, auto-save): changes are exported
 * as PNG and saved as they happen (`EmbedSession`). Light or dark as the widget (`data-scheme`); a change of scheme
 * saves what is pending and loads the editor again. Without an answer from the editor in time (or offline) it
 * says so (`failed`) and, if asked to, shows the picture instead. `dispose` saves what is pending.
 */
export class DiagramEditor {
  readonly #root: HTMLElement;
  readonly #body: HTMLElement;
  readonly #status: HTMLElement;
  #frame: HTMLIFrameElement | null;
  #session: EmbedSession;
  #loadTimer: ReturnType<typeof setTimeout> | null = null;
  #imageUrl: string | null = null;
  readonly #scheme: { host: HTMLElement | null; observer: MutationObserver | null };
  readonly #onMessage = (event: MessageEvent) => {
    if (this.#frame && event.source === this.#frame.contentWindow) this.#receive(event.data);
  };

  constructor(
    parent: HTMLElement,
    private readonly options: DiagramEditorOptions,
  ) {
    const doc = parent.ownerDocument;
    this.#root = element(doc, 'div', 'zwf-diagrams');
    this.#root.dataset.testid = 'zwf-diagram';
    const title = element(doc, 'h2', 'zwf-diagrams__title');
    title.textContent = ProjectPath.displayName(options.path);
    this.#body = element(doc, 'div', 'zwf-diagrams__body');
    this.#status = element(doc, 'p', 'zwf-diagrams__status');
    this.#status.setAttribute('role', 'status');
    this.#frame = element(doc, 'iframe', 'zwf-diagrams__frame');
    this.#frame.title = 'Diagram editor';
    this.#body.append(this.#status, this.#frame);
    this.#root.append(title, this.#body);
    parent.append(this.#root);
    doc.defaultView?.addEventListener('message', this.#onMessage);
    const host = parent.closest<HTMLElement>('[data-scheme]');
    this.#scheme = { host, observer: host ? new MutationObserver(() => this.#reload()) : null };
    this.#scheme.observer?.observe(host!, { attributes: true, attributeFilter: ['data-scheme'] });
    this.#session = this.#start(options.content);
  }

  /** Saves what is pending and takes the editor away. */
  dispose(): void {
    this.#session.flush();
    this.#clearLoadTimer();
    this.#scheme.observer?.disconnect();
    this.#root.ownerDocument.defaultView?.removeEventListener('message', this.#onMessage);
    if (this.#imageUrl) URL.revokeObjectURL(this.#imageUrl);
    this.#root.remove();
  }

  /** A session for `content`, with the editor (re)loading in the light or dark the widget has now. */
  #start(content: Uint8Array): EmbedSession {
    const frame = this.#frame!;
    const doc = frame.ownerDocument;
    const url = embedUrl(new URL(this.options.editorUrl, doc.baseURI).href, { dark: this.#scheme.host?.dataset.scheme === 'dark' });
    const origin = new URL(url).origin;
    const session = new EmbedSession({
      content,
      post: (message: EmbedAction) => frame.contentWindow?.postMessage(JSON.stringify(message), origin),
      save: (png) => this.options.save(png),
    });
    this.#showStatus('Loading the diagram editor…');
    this.#clearLoadTimer();
    if (doc.defaultView?.navigator.onLine === false) {
      queueMicrotask(() => this.#fail());
    } else {
      frame.src = url;
      this.#loadTimer = setTimeout(() => this.#fail(), this.options.loadTimeout ?? LOAD_TIMEOUT);
    }
    return session;
  }

  #receive(data: unknown): void {
    const wasReady = this.#session.initialized;
    this.#session.receive(data);
    if (wasReady || !this.#session.initialized) return;
    this.#clearLoadTimer();
    this.#showStatus(null);
  }

  /** The scheme changed: save what is pending and load the editor again, in the new colors. */
  #reload(): void {
    if (!this.#frame) return;
    this.#session.flush();
    this.#session = this.#start(this.#session.content);
  }

  async #fail(): Promise<void> {
    this.#loadTimer = null;
    if (!this.#frame || this.#session.initialized) return;
    this.#showStatus('The diagram editor could not be loaded.');
    if (await this.options.failed()) this.#showImage();
  }

  /** The picture of the diagram in place of the editor (read-only). */
  #showImage(): void {
    if (!this.#frame || !this.#root.isConnected) return;
    this.#session.flush();
    this.#frame.remove();
    this.#frame = null;
    const image = element(this.#root.ownerDocument, 'img', 'zwf-diagrams__image');
    image.alt = ProjectPath.displayName(this.options.path);
    this.#imageUrl = URL.createObjectURL(new Blob([this.#session.content as BlobPart], { type: 'image/png' }));
    image.src = this.#imageUrl;
    this.#showStatus(null);
    this.#body.append(image);
  }

  #showStatus(text: string | null): void {
    this.#status.textContent = text ?? '';
    this.#status.hidden = text === null;
  }

  #clearLoadTimer(): void {
    if (this.#loadTimer !== null) clearTimeout(this.#loadTimer);
    this.#loadTimer = null;
  }
}

export interface DiagramEditorOptions {
  readonly path: ProjectPath;
  /** The file's bytes when opened. */
  readonly content: Uint8Array;
  /** Where diagrams.net is (the setting `diagrams.editorUrl`; relative to the page if relative). */
  readonly editorUrl: string;
  /** Stores the diagram (a PNG with the diagram's XML in it). */
  save(png: Uint8Array): void;
  /** Tells the user the editor did not load; resolves to whether they want to see the picture instead. */
  failed(): Promise<boolean>;
  /** Default: 20 s. */
  readonly loadTimeout?: number;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const created = doc.createElement(tag);
  created.className = className;
  return created;
}

/** How long the editor may take to say it is ready before it counts as not loading (offline, blocked). */
const LOAD_TIMEOUT = 20_000;
