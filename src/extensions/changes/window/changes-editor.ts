// The Changes editor. See changes in ../changes.ts.
import { unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';

/**
 * A file's changes, read-only, in one CodeMirror (`@codemirror/merge`'s unified view): the new text, deleted lines in
 * red above where they were, inserted text green, unchanged stretches collapsed. `show` replaces what it shows, with
 * a title line ("intro.typ") and what is compared ("7be0c12 → 3f2a91c · Ann, Bob"); `showNote` shows only a line
 * of text (loading, a failure).
 *
 * Used by: the changes extension's editor `changes.diff`.
 */
export class ChangesEditor {
  readonly #root: HTMLElement;
  readonly #title: HTMLElement;
  readonly #detail: HTMLElement;
  readonly #view: EditorView;

  constructor(
    parent: HTMLElement,
    title: string,
    private readonly extensions: Extension,
  ) {
    const doc = parent.ownerDocument;
    this.#root = doc.createElement('div');
    this.#root.className = 'zwf-changes-editor';
    this.#title = doc.createElement('h2');
    this.#title.className = 'zwf-changes-editor__title';
    this.#title.textContent = title;
    this.#detail = doc.createElement('p');
    this.#detail.className = 'zwf-changes-editor__detail';
    this.#root.append(this.#title, this.#detail);
    parent.append(this.#root);
    this.#view = new EditorView({ parent: this.#root, state: this.#state('', '') });
    this.#view.dom.hidden = true;
  }

  /** Shows the changes from `original` to `modified`, described by `detail`. */
  show(original: string, modified: string, detail: string): void {
    this.#detail.textContent = original === modified ? `${detail} · no changes` : detail;
    this.#view.setState(this.#state(original, modified));
    this.#view.dom.hidden = false;
  }

  /** Shows `note` in place of changes. */
  showNote(note: string): void {
    this.#detail.textContent = note;
    this.#view.dom.hidden = true;
  }

  dispose(): void {
    this.#view.destroy();
    this.#root.remove();
  }

  #state(original: string, modified: string): EditorState {
    return EditorState.create({
      doc: modified,
      extensions: [
        lineNumbers(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        this.extensions,
        unifiedMergeView({ original, mergeControls: false, highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 6 } }),
      ],
    });
  }
}
