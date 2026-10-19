// TextFileEditor: a text file in plain CodeMirror. See textFiles in ../text-files.ts.
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { Transaction, type ChangeSpec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { ProjectPath } from '../../../core/paths/paths';

/**
 * The text file `path` in CodeMirror (its basic setup, as in the Source editor; its look from `extensions`; no language):
 * the text is saved `SAVE_DELAY` ms after the last edit, and at once by `dispose`. `reload` shows the file as changed
 * elsewhere (another user, the host): while an edit of this editor waits to be saved it is ignored, since that save
 * replaces the whole file anyway (the last save wins); otherwise the text changes in place, cursor and the user's undo
 * history kept.
 */
export class TextFileEditor {
  readonly #root: HTMLElement;
  readonly #view: EditorView;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private readonly options: TextFileEditorOptions,
  ) {
    const doc = parent.ownerDocument;
    this.#root = doc.createElement('div');
    this.#root.className = 'zwf-text-files';
    this.#root.dataset.testid = 'zwf-text-file';
    const title = doc.createElement('h2');
    title.className = 'zwf-text-files__title';
    title.textContent = ProjectPath.displayName(options.path);
    this.#root.append(title);
    parent.append(this.#root);
    this.#view = new EditorView({
      parent: this.#root,
      doc: options.text,
      extensions: [
        basicSetup,
        // Tab and Shift+Tab indent and outdent the selected lines; Escape, then Tab moves the focus on (CodeMirror's)
        keymap.of([indentWithTab]),
        EditorView.lineWrapping,
        options.extensions ?? [],
        EditorView.contentAttributes.of({ 'aria-label': ProjectPath.displayName(options.path) }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(Transaction.remote))) this.#scheduleSave();
        }),
      ],
    });
  }

  /** The file now holds `text` (changed elsewhere, or this editor's own save coming back). */
  reload(text: string): void {
    if (this.#timer !== null) return;
    const current = this.#view.state.doc.toString();
    if (text === current) return;
    this.#view.dispatch({
      changes: changeBetween(current, text),
      annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
    });
  }

  /** Selects `from..to` (offsets into the text, clamped), scrolls it into view and focuses the editor. */
  reveal(from: number, to: number): void {
    const length = this.#view.state.doc.length;
    const anchor = Math.min(from, length);
    this.#view.dispatch({ selection: { anchor, head: Math.min(Math.max(to, anchor), length) }, scrollIntoView: true });
    this.#view.focus();
  }

  /** Saves what is pending and takes the editor away. */
  dispose(): void {
    this.#save();
    this.#view.destroy();
    this.#root.remove();
  }

  #scheduleSave(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#save(), SAVE_DELAY);
  }

  /** Saves the text if an edit waits to be saved. */
  #save(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.options.save(this.#view.state.doc.toString());
  }
}

/** How long after the last keystroke the text is saved (as the diagram editor's exports). */
export const SAVE_DELAY = 800;

export interface TextFileEditorOptions {
  readonly path: ProjectPath;
  /** The file's text when opened. */
  readonly text: string;
  /** Stores the whole text (the file's new content). */
  save(text: string): void;
  /** More of CodeMirror (the shared extensions: document links, the look). */
  readonly extensions?: Extension;
}

/** The one replacement that turns `from` into `to` (the common start and end stay, so the cursor around them does). */
function changeBetween(from: string, to: string): ChangeSpec {
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start]) start++;
  let end = 0;
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++;
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) };
}
