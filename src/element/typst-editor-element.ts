import { createTypstEditor, type ProjectFiles, type TypstEditor } from '../editor/typst-editor';
import { inlineSource } from './inline-source';

/** `detail` of the `change` event the element dispatches after every user edit. */
export interface TypstEditorChangeDetail {
  value: string;
}

/** `detail` of the `commentschange` event: all review comments as JSON. */
export interface TypstEditorCommentsChangeDetail {
  comments: string;
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
 * The `files` property holds the project's other files (see `ProjectFiles`).
 * Review comments: the `comments` property (JSON, kept beside the source),
 * the `user` property (`{ name }`, the author of new comments), and a
 * `commentschange` event with `detail.comments` whenever they change.
 */
export class TypstEditorElement extends Base {
  static readonly observedAttributes = ['value'];

  #editor: TypstEditor | null = null;
  #value: string | null = null;
  #files: ProjectFiles = {};
  #comments: string | undefined;
  /** Author of the comments written here; read when the element connects. */
  user: { name: string } | undefined;
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

  /** Other project files the source can include, import or load as images. */
  get files(): ProjectFiles {
    return this.#files;
  }

  set files(files: ProjectFiles) {
    this.#files = files;
    if (this.#editor) this.#editor.files = files;
  }

  /** The review comments as JSON (see `TypstEditorOptions.comments`). */
  get comments(): string {
    return this.#editor?.comments ?? this.#comments ?? '';
  }

  set comments(json: string) {
    this.#comments = json;
    if (this.#editor) this.#editor.comments = json;
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
      onChange: (value) => this.#changed(value),
      comments: this.#comments,
      user: this.user,
      onCommentsChange: (comments) => {
        this.#comments = comments;
        const detail: TypstEditorCommentsChangeDetail = { comments };
        this.dispatchEvent(new CustomEvent('commentschange', { detail, bubbles: true, composed: true }));
      },
    });
  }

  disconnectedCallback(): void {
    // Keep the text so a moved element comes back with it.
    this.#value = this.#editor?.source ?? this.#value;
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
