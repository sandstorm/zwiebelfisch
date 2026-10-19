import { createEditor, type Editor, type EditorOptions } from '../editor/editor';
import type { FileChange, FileContent, ProjectFiles } from '../core/project/project';
import type { ProjectPath } from '../core/paths/paths';
import type { Disposable } from '../core/disposable/disposable';
import type { Event } from '../core/event-emitter/event-emitter';
import { mergeSettings, type Settings } from '../hosts/workspace/workspace';

/**
 * `<zwiebelfisch-editor>`: the editor widget as a custom element, for pages that should need no glue code.
 *
 * Used from plain HTML and from any framework that renders elements (React, Vue, server templates). The editor lives
 * and dies with the element (connect, move, remove); an open shadow root keeps the page's CSS and the editor's apart.
 *
 * - `options` (`Partial<EditorOptions>`): everything `createEditor` takes, read when the element
 *   connects.
 * - `settings` attribute: JSON of settings by full id (`settings='{"pdfExport.download": false}'`), over
 *   `options.settings` id by id; read on connect and whenever it changes: a new value replaces the attribute's ids
 *   (an id it no longer has goes back to `options.settings`' value, else its default), other ids keep theirs.
 *   The `settings` property is the current settings; `updateSettings` merges, as `Editor.updateSettings`.
 * - `value` attribute (wins over `options.source`); without it (attribute or property), the element's text content
 *   (common indentation removed), if any, is the main file's text.
 * - `files` (all files, the main one included) and `value` (the main file's text, a shortcut) are the
 *   current content; setting them replaces it without events, as with `<input>`.
 * - Events (bubbling, composed): `change` for every file whose content changes (`EditorChangeDetail`),
 *   `files-change` with every `FileChange` (`onDidChangeFiles`), `main-file-change` with `{ path }`
 *   (`onDidChangeMainFile`), `open` with `{ path }` (`onDidChangeActiveFile`).
 * - `executeCommand(id, ...args)` runs an extension's command; `exportPdf(options?)` gives the PDF as a Blob.
 */
export class EditorElement extends Base() {
  static readonly observedAttributes = ['value', 'settings'];

  #options: Partial<EditorOptions> = {};
  #editor: Editor | null = null;
  /** The subscriptions to the editor's events (EVENTS), while connected. */
  #subscriptions: Disposable[] = [];
  /** The text, files and settings set while not connected, or kept from the last connection. */
  #source: string | null = null;
  #files: ProjectFiles | null = null;
  #settings: Settings | null = null;
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

  /** Options for `createEditor`, read when the element connects (see the class). */
  get options(): Partial<EditorOptions> {
    return this.#options;
  }

  set options(options: Partial<EditorOptions>) {
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

  /** Every file of the project, the main file included (see `Editor.files`). */
  get files(): ProjectFiles {
    return this.#editor?.files ?? this.#files ?? this.options.files ?? {};
  }

  set files(files: ProjectFiles) {
    this.#files = files;
    this.#quietly((editor) => (editor.files = files));
  }

  /** The settings by full id (see `Editor.settings`). */
  get settings(): Settings {
    return this.#editor?.settings ?? this.#settings ?? this.#initialSettings();
  }

  /** Merges `settings` into the current ones; `undefined` resets an id to its default (see `Editor.updateSettings`). */
  updateSettings(settings: Settings): void {
    if (this.#editor) this.#editor.updateSettings(settings);
    else this.#settings = mergeSettings(this.settings, settings);
  }

  /** Runs an extension's command (see `Editor.executeCommand`); rejects while not connected. */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> {
    if (!this.#editor) return Promise.reject(new Error('<zwiebelfisch-editor> is not connected'));
    return this.#editor.executeCommand<T>(id, ...args);
  }

  /** The project as a PDF, with the export options as given (see `Editor.exportPdf`); rejects while not connected. */
  exportPdf(options?: Record<string, boolean>): Promise<Blob> {
    if (!this.#editor) return Promise.reject(new Error('<zwiebelfisch-editor> is not connected'));
    return this.#editor.exportPdf(options);
  }

  connectedCallback(): void {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = hostStyles;
    const container = document.createElement('div');
    container.style.height = '100%';
    root.replaceChildren(style, container);
    this.#editor = createEditor(container, {
      ...this.options,
      source: this.#source ?? this.#initialSource(),
      files: this.#files ?? this.options.files,
      settings: this.#settings ?? this.#initialSettings(),
    });
    this.#subscriptions = this.#forwardEvents(this.#editor);
  }

  disconnectedCallback(): void {
    // Keep the content so a moved element comes back with it.
    if (this.#editor) {
      this.#source = this.#editor.source;
      this.#files = this.#editor.files;
      this.#settings = this.#editor.settings;
    }
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#subscriptions = [];
    this.#editor?.dispose();
    this.#editor = null;
    this.shadowRoot?.replaceChildren();
  }

  attributeChangedCallback(name: string, old: string | null, value: string | null): void {
    if (name === 'value') this.value = value ?? '';
    else if (this.#editor) this.updateSettings(this.#attributeChange(old, value));
  }

  /** Subscribes to the events of EVENTS on `editor`, each dispatching its DOM events. */
  #forwardEvents(editor: Editor): Disposable[] {
    return Object.entries(EVENTS).map(([name, events]) =>
      (editor[name as EventName] as Event<never>)((value) => {
        for (const [type, detail] of events(value, () => this.files)) this.#dispatch(type, detail);
      }),
    );
  }

  #quietly(set: (editor: Editor) => void): void {
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

  /** The `settings` attribute's change from `old` to `value`: its ids, and those it dropped back to `options.settings`. */
  #attributeChange(old: string | null, value: string | null): Settings {
    const dropped = Object.keys(parseSettings(old, false)).map((id) => [id, this.options.settings?.[id]]);
    return { ...Object.fromEntries(dropped), ...parseSettings(value) };
  }

  /** `options.settings`, and over them those of the `settings` attribute (JSON; ignored, with a warning, if it is not an object). */
  #initialSettings(): Settings {
    return { ...this.options.settings, ...parseSettings(this.getAttribute('settings')) };
  }
}

/**
 * `detail` of the `change` event: what the file at `path` holds after a change. `content` is null when the
 * file is gone (deleted, or renamed away: a rename is one `change` for each of the two paths).
 */
export interface EditorChangeDetail {
  path: ProjectPath;
  content: FileContent | null;
}

/** Registers the element under `name` (default `zwiebelfisch-editor`); does nothing if it already is. */
export function defineEditorElement(name = 'zwiebelfisch-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, class extends EditorElement {});
}

/** HTMLElement, or a plain class where there is no DOM (SSR, unit tests), so this module can be imported there. */
function Base(): typeof HTMLElement {
  return (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;
}

const hostStyles = ':host { display: block; height: 24rem; } :host([hidden]) { display: none; }';

/** The editor's events the element forwards as DOM events. */
const EVENTS: { [Name in EventName]: Forward<EventValue<Editor[Name]>> } = {
  onDidChangeFiles: (change, files) => [['files-change', change], ...changedFiles(change, files).map((detail): [string, unknown] => ['change', detail])],
  onDidChangeMainFile: (path) => [['main-file-change', { path }]],
  onDidChangeActiveFile: (path) => [['open', { path }]],
};

/** The handle's events (`onDid…`). */
type EventName = { [Name in keyof Editor]: Editor[Name] extends Event<infer _Value> ? Name : never }[keyof Editor];
type EventValue<E> = E extends Event<infer T> ? T : never;

/** The DOM events (type, `detail`) one firing of the editor's event makes; `files`: every file now. */
type Forward<T> = (value: T, files: () => ProjectFiles) => [type: string, detail: unknown][];

/** What each path touched by `change` holds now (`files`: every file now). */
function changedFiles(change: FileChange, files: () => ProjectFiles): EditorChangeDetail[] {
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

/**
 * The Typst source written inside the element: without the newline after the opening tag, the trailing blank lines
 * and the indentation common to all non-blank lines (HTML indents it with the page); ends with one newline, or empty.
 */
function inlineSource(text: string): string {
  const lines = text.replace(/^\r?\n/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return '';
  const indents = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)![0].length);
  const indent = Math.min(...indents);
  return lines.map((line) => (line.slice(indent).trimEnd() === '' ? '' : line.slice(indent))).join('\n') + '\n';
}

/** The settings in the JSON of a `settings` attribute; none if it is no JSON object (with a warning, if `warn`). */
function parseSettings(json: string | null, warn = true): Settings {
  if (json === null) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Settings;
  } catch {
    // reported below
  }
  if (warn) console.warn(`<zwiebelfisch-editor>: the settings attribute is not a JSON object: ${json}`);
  return {};
}

declare global {
  interface HTMLElementTagNameMap {
    'zwiebelfisch-editor': EditorElement;
  }
}
