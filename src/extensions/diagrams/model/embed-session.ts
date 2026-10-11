// EmbedSession. See ../diagrams.ts.
import { fromDataUri, isPng, readDiagramXml, toDataUri, writeDiagramXml } from './png';

/**
 * The embed protocol of one opened diagram, with auto-save: `init` → `load` (the file as `xmlpng`, `autosave: 1`);
 * every `autosave` (and `save`) → `export` as `xmlpng` (one at a time: changes during an export ask for one more
 * afterwards); every exported PNG is saved `delay` ms after the last one (the last export wins). `flush` (the file
 * is closed, the widget disposed) saves the pending export at once, and a diagram changed since the last export
 * into the last PNG (its picture follows with the next export).
 *
 * One conversation with diagrams.net's embed mode (https://www.drawio.com/doc/faq/embed-mode, `proto=json`) as pure
 * state: what to send the editor for each message it sends, and when to save the file. The view only carries messages
 * between the iframe and this.
 */
export class EmbedSession {
  #saved: Saved;
  /** The diagram as the editor last reported it (autosave / save). */
  #xml: string | null = null;
  #exporting = false;
  /** Changes came in while exporting: export again when it returns. */
  #again = false;
  #pending: { png: Uint8Array; xml: string | null } | null = null;
  #timer: unknown = null;
  #initialized = false;
  readonly #timers: Timers;

  constructor(private readonly options: EmbedSessionOptions) {
    this.#saved = { png: options.content, xml: readDiagramXml(options.content), stale: false };
    this.#timers = options.timers ?? globalThis;
  }

  /** Whether the editor said it is ready (`init`): it loaded. */
  get initialized(): boolean {
    return this.#initialized;
  }

  /** The file as last saved (or as opened): what to load the editor with again. */
  get content(): Uint8Array {
    return this.#saved.png;
  }

  /** A message from the editor: a JSON string (`proto=json`) or its object. Anything else is ignored. */
  receive(data: unknown): void {
    const message = parse(data);
    if (message?.event === 'init') this.#init();
    else if (message?.event === 'autosave' || message?.event === 'save') this.#changed(message.xml);
    else if (message?.event === 'export') this.#exported(message);
  }

  /** Saves at once what is pending: the last export, and a diagram changed since. */
  flush(): void {
    this.#cancelTimer();
    if (this.#pending) this.#write(this.#pending.png, this.#pending.xml, false);
    const xml = this.#xml;
    if (xml !== null && xml !== this.#saved.xml && isPng(this.#saved.png)) this.#write(writeDiagramXml(this.#saved.png, xml), xml, true);
  }

  #init(): void {
    this.#initialized = true;
    const { png } = this.#saved;
    this.options.post(isPng(png) ? { action: 'load', autosave: 1, xmlpng: toDataUri(png) } : { action: 'load', autosave: 1, xml: '' });
  }

  #changed(xml: unknown): void {
    if (typeof xml === 'string') this.#xml = xml;
    if (this.#exporting) {
      this.#again = true;
      return;
    }
    this.#exporting = true;
    this.options.post({ action: 'export', format: 'xmlpng' });
  }

  #exported(message: Message): void {
    if (message.format !== 'xmlpng' || !this.#exporting) return;
    this.#exporting = false;
    const png = typeof message.data === 'string' ? fromDataUri(message.data) : null;
    if (png) {
      const xml = typeof message.xml === 'string' ? message.xml : this.#xml;
      this.#pending = { png, xml };
      this.#cancelTimer();
      this.#timer = this.#timers.setTimeout(() => this.#savePending(), this.options.delay ?? SAVE_DELAY);
    }
    if (this.#again) {
      this.#again = false;
      this.#changed(undefined);
    }
  }

  #savePending(): void {
    this.#timer = null;
    if (this.#pending) this.#write(this.#pending.png, this.#pending.xml, false);
  }

  /** Saves `png` unless it holds what the file holds already (an unchanged diagram after loading). */
  #write(png: Uint8Array, xml: string | null, stale: boolean): void {
    this.#pending = null;
    const saved = this.#saved;
    if (!stale && !saved.stale && xml !== null && xml === saved.xml) return;
    this.#saved = { png, xml, stale };
    this.options.save(png);
  }

  #cancelTimer(): void {
    if (this.#timer !== null) this.#timers.clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/** How long the session waits after the last export before it saves (a save recompiles the document). */
export const SAVE_DELAY = 800;

/** Timers (the browser's by default; tests pass their own). */
export interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EmbedSessionOptions {
  /** The file's bytes when it was opened. */
  readonly content: Uint8Array;
  /** Sends a message to the editor (the view posts it as JSON). */
  post(message: EmbedAction): void;
  /** Stores the new file (a PNG with the diagram in it). */
  save(png: Uint8Array): void;
  /** Default: the browser's. */
  readonly timers?: Timers;
  /** Default: `SAVE_DELAY`. */
  readonly delay?: number;
}

/** What the session sends to the editor. */
export type EmbedAction =
  | { readonly action: 'load'; readonly autosave: 1; readonly xmlpng: string }
  | { readonly action: 'load'; readonly autosave: 1; readonly xml: string }
  | { readonly action: 'export'; readonly format: 'xmlpng' };

/** The URL of the embedded editor at `base` (a diagrams.net installation): embed mode, JSON protocol, no Save / Exit buttons, light or dark. */
export function embedUrl(base: string, options: { dark: boolean }): string {
  const url = new URL(base);
  const params = { embed: '1', proto: 'json', spin: '1', noSaveBtn: '1', noExitBtn: '1', saveAndExit: '0', dark: options.dark ? '1' : '0' };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.href;
}

/** What the file holds as last saved (or as opened): its bytes and the diagram in them. */
interface Saved {
  readonly png: Uint8Array;
  readonly xml: string | null;
  /** The picture is older than the diagram (saved without an export, see `flush`). */
  readonly stale: boolean;
}

function parse(data: unknown): Message | null {
  let value = data;
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null && typeof (value as Message).event === 'string' ? (value as Message) : null;
}

/** A message of the editor (`{ event, … }`). */
interface Message {
  readonly event: string;
  readonly xml?: unknown;
  readonly format?: unknown;
  readonly data?: unknown;
}
