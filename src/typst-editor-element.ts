// <typst-editor>: the editor as a custom element in a shadow root, around createTypstEditor.
// Why one `options` property: the element must offer every option createTypstEditor has, without listing (and
// forgetting) them one by one; only what fits an HTML attribute is an attribute as well. See docs/embedding.md.
import { createTypstEditor, type FileChange, type FileContent, type FileListMode, type PdfExportOptions, type ProjectFiles, type Theme, type TypstEditor, type TypstEditorOptions } from './typst-editor';
import type { ProjectPath } from './core/paths/paths';
import { inlineSource } from './typst-editor-element/inline-source';

/**
 * `detail` of the `change` event: what the file at `path` holds after a change. `content` is null when the
 * file is gone (deleted, or renamed away: a rename is one `change` for each of the two paths).
 */
export interface TypstEditorChangeDetail {
  path: ProjectPath;
  content: FileContent | null;
}

/**
 * `<typst-editor>`: the editor widget as a custom element, rendered in an open
 * shadow root so page styles and editor styles cannot leak into each other.
 *
 * - `options` (`Partial<TypstEditorOptions>`): everything `createTypstEditor` takes, read when the element
 *   connects. Its `onFilesChange` / `onOpen` are called as well as the events below.
 * - Attributes win over `options`: `value` over `source`, `file-list` over `fileList`, `pdf-download="hide"`
 *   over `pdfDownload`, `theme` over `theme`. Without `value` (attribute or property), the element's text
 *   content (common indentation removed), if any, is the main file's text.
 * - `files` (all files, the main one included) and `value` (the main file's text, a shortcut) are the
 *   current content; setting them replaces it without events, as with `<input>`.
 * - Events (bubbling, composed): `change` for every file whose content changes (`TypstEditorChangeDetail`),
 *   `files-change` with every `FileChange` (the same as `onFilesChange`), `open` with `{ path }`.
 * - `exportPdf({ comments })` gives the PDF as a Blob.
 */
export class TypstEditorElement extends Base() {
  static readonly observedAttributes = ['value'];

  #options: Partial<TypstEditorOptions> = {};
  #editor: TypstEditor | null = null;
  /** The text and files set while not connected, or kept from the last connection. */
  #source: string | null = null;
  #files: ProjectFiles | null = null;
  /** While the host sets `value` / `files`: no events, as with `<input>`. */
  #quiet = false;

  constructor() {
    super();
    // Set on the element before it was defined (upgraded): own properties that hide the accessors below.
    for (const property of ['options', 'value', 'files'] as const) {
      if (!Object.hasOwn(this, property)) continue;
      const value = this[property] as never;
      delete this[property];
      this[property] = value;
    }
  }

  /** Options for `createTypstEditor`, read when the element connects; attributes win (see the class). */
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

  /** The project as a PDF, with or without comments (see `TypstEditor.exportPdf`); rejects while not connected. */
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
    const options = this.options;
    const pdfDownload = this.getAttribute('pdf-download');
    this.#editor = createTypstEditor(container, {
      ...options,
      source: this.#source ?? this.#initialSource(),
      files: this.#files ?? options.files,
      fileList: (this.getAttribute('file-list') as FileListMode | null) ?? options.fileList,
      pdfDownload: pdfDownload === null ? options.pdfDownload : pdfDownload !== 'hide',
      theme: (this.getAttribute('theme') as Theme | null) ?? options.theme,
      onFilesChange: (change) => {
        options.onFilesChange?.(change);
        this.#filesChanged(change);
      },
      onOpen: (path) => {
        options.onOpen?.(path);
        this.#dispatch('open', { path });
      },
    });
  }

  disconnectedCallback(): void {
    // Keep the content so a moved element comes back with it.
    if (this.#editor) {
      this.#source = this.#editor.source;
      this.#files = this.#editor.files;
    }
    this.#editor?.destroy();
    this.#editor = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    this.value = value ?? '';
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

  #filesChanged(change: FileChange): void {
    if (this.#quiet) return;
    this.#dispatch('files-change', change);
    for (const detail of this.#changedFiles(change)) this.#dispatch('change', detail);
  }

  /** What each path touched by `change` holds now. */
  #changedFiles(change: FileChange): TypstEditorChangeDetail[] {
    switch (change.kind) {
      case 'create':
      case 'update':
        return [{ path: change.path, content: change.content }];
      case 'delete':
        return [{ path: change.path, content: null }];
      case 'rename':
        return [{ path: change.from, content: null }, { path: change.path, content: this.#editor?.files[change.path] ?? null }];
    }
  }

  #dispatch(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  /** From the `value` attribute, else the element's text content, else `options.source` (all may be absent). */
  #initialSource(): string | undefined {
    const inline = inlineSource(this.textContent ?? '');
    return this.getAttribute('value') ?? (inline === '' ? undefined : inline) ?? this.options.source;
  }
}

/** Registers the element under `name` (default `typst-editor`); does nothing if it already is. */
export function defineTypstEditorElement(name = 'typst-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, class extends TypstEditorElement {});
}

const hostStyles = ':host { display: block; height: 24rem; } :host([hidden]) { display: none; }';

/** HTMLElement, or a plain class where there is no DOM (SSR, unit tests), so this module can be imported there. */
function Base(): typeof HTMLElement {
  return (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;
}

declare global {
  interface HTMLElementTagNameMap {
    'typst-editor': TypstEditorElement;
  }
}
