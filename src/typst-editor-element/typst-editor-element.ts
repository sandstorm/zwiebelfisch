// <typst-editor>: the editor as a custom element in a shadow root, around createTypstEditor.
// Why a thin adapter: the element must offer everything createTypstEditor has without listing (and forgetting) it
// option by option. So it passes one `options` property through, maps one `settings` attribute (JSON) onto the
// settings the extensions declare, and forwards the editor's callbacks as DOM events from one table; the content
// (`value`, `files`) is all it knows by name, as with `<input>`. See docs/embedding.md.
import { createTypstEditor, type PdfExportOptions, type TypstEditor, type TypstEditorOptions } from '../typst-editor/typst-editor';
import type { FileChange, FileContent, ProjectFiles } from '../core/project/project';
import type { ProjectPath } from '../core/paths/paths';
import type { Settings } from '../hosts/workbench/workbench';
import { inlineSource } from './inline-source';

/**
 * `detail` of the `change` event: what the file at `path` holds after a change. `content` is null when the
 * file is gone (deleted, or renamed away: a rename is one `change` for each of the two paths).
 */
export interface TypstEditorChangeDetail {
  path: ProjectPath;
  content: FileContent | null;
}

/** The events (type, `detail`) a call of the editor's callback makes; `files`: every file now. */
type Forward = (value: never, files: () => ProjectFiles) => [type: string, detail: unknown][];

/** The editor's callbacks the element forwards as DOM events. */
const EVENTS: Record<string, Forward> = {
  onFilesChange: (change: FileChange, files) => [['files-change', change], ...changedFiles(change, files).map((detail): [string, unknown] => ['change', detail])],
  onOpen: (path: string) => [['open', { path }]],
};

/**
 * `<typst-editor>`: the editor widget as a custom element, rendered in an open
 * shadow root so page styles and editor styles cannot leak into each other.
 *
 * - `options` (`Partial<TypstEditorOptions>`): everything `createTypstEditor` takes, read when the element
 *   connects. Its callbacks are called as well as the events below.
 * - `settings` attribute: JSON of settings by full id (`settings='{"pdfExport.download": false}'`), over
 *   `options.settings` id by id; read on connect and whenever it changes. The `settings` property is the current
 *   settings; setting it replaces them.
 * - `value` attribute (wins over `options.source`); without it (attribute or property), the element's text content
 *   (common indentation removed), if any, is the main file's text.
 * - `files` (all files, the main one included) and `value` (the main file's text, a shortcut) are the
 *   current content; setting them replaces it without events, as with `<input>`.
 * - Events (bubbling, composed): `change` for every file whose content changes (`TypstEditorChangeDetail`),
 *   `files-change` with every `FileChange` (`onFilesChange`), `open` with `{ path }` (`onOpen`).
 * - `executeCommand(id, ...args)` runs an extension's command; `exportPdf({ options })` gives the PDF as a Blob.
 */
export class TypstEditorElement extends Base() {
  static readonly observedAttributes = ['value', 'settings'];

  #options: Partial<TypstEditorOptions> = {};
  #editor: TypstEditor | null = null;
  /** The text, files and settings set while not connected, or kept from the last connection. */
  #source: string | null = null;
  #files: ProjectFiles | null = null;
  #settings: Settings | null = null;
  /** While the host sets `value` / `files`: no events, as with `<input>`. */
  #quiet = false;

  constructor() {
    super();
    // Set on the element before it was defined (upgraded): own properties that hide the accessors below.
    for (const property of ['options', 'value', 'files', 'settings'] as const) {
      if (!Object.hasOwn(this, property)) continue;
      const value = this[property] as never;
      delete this[property];
      this[property] = value;
    }
  }

  /** Options for `createTypstEditor`, read when the element connects (see the class). */
  get options(): Partial<TypstEditorOptions> {
    return this.#options;
  }

  set options(options: Partial<TypstEditorOptions>) {
    this.#options = options;
  }

  /** The main file's text. */
  get value(): string {
    return this.#editor?.source ?? this.#source ?? this.#initialSource() ?? '';
  }

  set value(text: string) {
    this.#source = text;
    this.#quietly((editor) => (editor.source = text));
  }

  /** Every file of the project, the main file included (see `TypstEditor.files`). */
  get files(): ProjectFiles {
    return this.#editor?.files ?? this.#files ?? this.options.files ?? {};
  }

  set files(files: ProjectFiles) {
    this.#files = files;
    this.#quietly((editor) => (editor.files = files));
  }

  /** The settings by full id (see `TypstEditor.settings`); setting them replaces them. */
  get settings(): Settings {
    return this.#editor?.settings ?? this.#settings ?? this.#initialSettings();
  }

  set settings(settings: Settings) {
    this.#settings = settings;
    if (this.#editor) this.#editor.settings = settings;
  }

  /** Runs an extension's command (see `TypstEditor.executeCommand`); rejects while not connected. */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    if (!this.#editor) return Promise.reject(new Error('<typst-editor> is not connected'));
    return this.#editor.executeCommand<T>(id, ...args);
  }

  /** The project as a PDF, with the export options as given (see `TypstEditor.exportPdf`); rejects while not connected. */
  exportPdf(options?: PdfExportOptions): Promise<Blob> {
    if (!this.#editor) return Promise.reject(new Error('<typst-editor> is not connected'));
    return this.#editor.exportPdf(options);
  }

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = hostStyles;
    const container = document.createElement('div');
    container.style.height = '100%';
    root.replaceChildren(style, container);
    this.#editor = createTypstEditor(container, {
      ...this.options,
      ...this.#forwardedEvents(),
      source: this.#source ?? this.#initialSource(),
      files: this.#files ?? this.options.files,
      settings: this.#settings ?? this.#initialSettings(),
    });
  }

  disconnectedCallback(): void {
    // Keep the content so a moved element comes back with it.
    if (this.#editor) {
      this.#source = this.#editor.source;
      this.#files = this.#editor.files;
      this.#settings = this.#editor.settings;
    }
    this.#editor?.destroy();
    this.#editor = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    if (name === 'value') this.value = value ?? '';
    else if (this.#editor) this.settings = this.#initialSettings();
  }

  /** The callbacks of EVENTS: the host's own (from `options`), then the event. */
  #forwardedEvents(): Partial<TypstEditorOptions> {
    const options = this.options as Record<string, ((value: unknown) => void) | undefined>;
    const forwarded: Record<string, (value: never) => void> = {};
    for (const [name, events] of Object.entries(EVENTS)) {
      forwarded[name] = (value: never) => {
        options[name]?.(value);
        for (const [type, detail] of events(value, () => this.files)) this.#dispatch(type, detail);
      };
    }
    return forwarded;
  }

  #quietly(set: (editor: TypstEditor) => void): void {
    if (!this.#editor) return;
    this.#quiet = true;
    try {
      set(this.#editor);
    } finally {
      this.#quiet = false;
    }
  }

  #dispatch(type: string, detail: unknown): void {
    if (this.#quiet) return;
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** From the `value` attribute, else the element's text content, else `options.source` (all may be absent). */
  #initialSource(): string | undefined {
    const inline = inlineSource(this.textContent ?? '');
    return this.getAttribute('value') ?? (inline === '' ? undefined : inline) ?? this.options.source;
  }

  /** `options.settings`, and over them those of the `settings` attribute (JSON; ignored, with a warning, if it is not an object). */
  #initialSettings(): Settings {
    return { ...this.options.settings, ...parseSettings(this.getAttribute('settings')) };
  }
}

/** Registers the element under `name` (default `typst-editor`); does nothing if it already is. */
export function defineTypstEditorElement(name = 'typst-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, class extends TypstEditorElement {});
}

const hostStyles = ':host { display: block; height: 24rem; } :host([hidden]) { display: none; }';

/** What each path touched by `change` holds now (`files`: every file now). */
function changedFiles(change: FileChange, files: () => ProjectFiles): TypstEditorChangeDetail[] {
  switch (change.kind) {
    case 'create':
    case 'update':
      return [{ path: change.path, content: change.content }];
    case 'delete':
      return [{ path: change.path, content: null }];
    case 'rename':
      return [{ path: change.from, content: null }, { path: change.path, content: files()[change.path] ?? null }];
  }
}

function parseSettings(json: string | null): Settings {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    // reported below
  }
  console.warn(`<typst-editor>: the settings attribute is not a JSON object: ${json}`);
  return {};
}

/** HTMLElement, or a plain class where there is no DOM (SSR, unit tests), so this module can be imported there. */
function Base(): typeof HTMLElement {
  return (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;
}

declare global {
  interface HTMLElementTagNameMap {
    'typst-editor': TypstEditorElement;
  }
}
