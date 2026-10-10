// <typst-editor>: the editor as a custom element in a shadow root, around createTypstEditor.
// See docs/embedding.md.
import { createTypstEditor, type CollaborationOptions, type FileChange, type FileListMode, type PdfExportOptions, type ProjectFiles, type Theme, type TypstEditor } from './typst-editor';
import { inlineSource } from './typst-editor-element/inline-source';

/** `detail` of the `change` event the element dispatches after every user edit. */
export interface TypstEditorChangeDetail {
  value: string;
}

const hostStyles = ':host { display: block; height: 24rem; } :host([hidden]) { display: none; }';

// Lets this module be imported where there is no DOM (SSR, unit tests).
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<typst-editor>`: the editor widget as a custom element, rendered in an open
 * shadow root so page styles and editor styles cannot leak into each other.
 *
 * The initial source comes from the `value` attribute or, if absent, from the
 * element's text content (common indentation removed). `value` is also a
 * property; setting it (or the attribute) replaces the source without a
 * `change` event. User edits dispatch `change` with `detail.value`.
 * The `files` property holds the project's other files (see `ProjectFiles`);
 * the file panel on the left opens with more than one file (attribute
 * `file-list`: `auto` | `show` | `hide`). Every file change, including edits of other
 * files, dispatches `files-change` with the `FileChange` as `detail`.
 * Comments are `drafting` margin notes in the source itself (the "Comment"
 * button), so they arrive with `value` and `change` like any other text.
 * Collaboration: the `collaboration` and `user` properties (see
 * `TypstEditorOptions`), read when the element connects.
 * `exportPdf({ comments })` gives the PDF as a Blob; the preview's "Download
 * PDF" button goes away with `pdf-download="hide"`. Colors: as the page's `color-scheme`, or the
 * `theme` attribute (`light` | `dark` | `auto`, read when the element connects).
 */
export class TypstEditorElement extends Base {
  static readonly observedAttributes = ['value'];

  #editor: TypstEditor | null = null;
  #value: string | null = null;
  #files: ProjectFiles = {};
  /** Who others see when collaborating; read when the element connects. */
  user: { name: string; color?: string } | undefined;
  /** Real-time collaboration (see `TypstEditorOptions.collaboration`); read when the element connects. */
  collaboration: CollaborationOptions | undefined;
  #base: string | null = null;
  #settingValue = false;

  get value(): string {
    return this.#editor?.source ?? this.#value ?? this.#initialSource();
  }

  set value(text: string) {
    this.#value = text;
    if (!this.#editor) return;
    this.#settingValue = true;
    try {
      this.#editor.source = text;
    } finally {
      this.#settingValue = false;
    }
  }

  /** Other project files the source can include, import or load as images (with current text). */
  get files(): ProjectFiles {
    return this.#editor?.files ?? this.#files;
  }

  set files(files: ProjectFiles) {
    this.#files = files;
    if (this.#editor) this.#editor.files = files;
  }

  /** The project as a PDF, with or without comments (see `TypstEditor.exportPdf`); rejects while not connected. */
  exportPdf(options?: PdfExportOptions): Promise<Blob> {
    if (!this.#editor) return Promise.reject(new Error('<typst-editor> is not connected'));
    return this.#editor.exportPdf(options);
  }

  /** Shows the changes against `base` (an earlier source), or none for null. */
  setBase(base: string | null): void {
    this.#base = base;
    this.#editor?.setBase(base);
  }

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = hostStyles;
    const container = document.createElement('div');
    container.style.height = '100%';
    root.replaceChildren(style, container);
    this.#editor = createTypstEditor(container, {
      source: this.value,
      files: this.#files,
      fileList: (this.getAttribute('file-list') ?? undefined) as FileListMode | undefined,
      base: this.#base ?? undefined,
      pdfDownload: this.getAttribute('pdf-download') !== 'hide',
      theme: (this.getAttribute('theme') ?? undefined) as Theme | undefined,
      onChange: (value) => this.#changed(value),
      onFilesChange: (change) => this.#filesChanged(change),
      onOpen: (path) => this.dispatchEvent(new CustomEvent('open', { detail: { path }, bubbles: true, composed: true })),
      user: this.user,
      collaboration: this.collaboration,
    });
  }

  disconnectedCallback(): void {
    // Keep the text so a moved element comes back with it.
    this.#value = this.#editor?.source ?? this.#value;
    this.#files = this.#editor?.files ?? this.#files;
    this.#editor?.destroy();
    this.#editor = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    this.value = value ?? '';
  }

  #changed(value: string): void {
    this.#value = value;
    if (this.#settingValue) return;
    const detail: TypstEditorChangeDetail = { value };
    this.dispatchEvent(new CustomEvent('change', { detail, bubbles: true, composed: true }));
  }

  #filesChanged(change: FileChange): void {
    if (this.#settingValue) return;
    this.dispatchEvent(new CustomEvent('files-change', { detail: change, bubbles: true, composed: true }));
  }

  #initialSource(): string {
    return this.getAttribute('value') ?? inlineSource(this.textContent ?? '');
  }
}

/** Registers the element under `name` (default `typst-editor`); does nothing if it already is. */
export function defineTypstEditorElement(name = 'typst-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, class extends TypstEditorElement {});
}

declare global {
  interface HTMLElementTagNameMap {
    'typst-editor': TypstEditorElement;
  }
}
