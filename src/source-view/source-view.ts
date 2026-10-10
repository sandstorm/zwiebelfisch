import { basicSetup } from 'codemirror';
import { Annotation, EditorSelection, StateEffect, StateField, type ChangeSet, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { typst_lezer } from 'codemirror-lang-typst/lezer';
import type { TextChange, TypstDocument } from '../document/typst-document';

/** Marks transactions that mirror a document change, so they are not sent back. */
const fromDocument = Annotation.define<boolean>();

const setHighlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) {
        const range = effect.value;
        decorations = range && range.from < range.to
          ? Decoration.set(Decoration.mark({ class: 'typst-source__jump' }).range(range.from, range.to))
          : Decoration.none;
      }
    }
    return tr.docChanged ? decorations.map(tr.changes) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface SourceViewOptions {
  /** Called with the cursor offset whenever the selection moves. */
  onCursor?(offset: number): void;
}

/**
 * The plain-Typst editing view (CodeMirror 6), kept in sync with a
 * TypstDocument in both directions.
 */
export class SourceView {
  private readonly view: EditorView;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions = {}) {
    this.view = new EditorView({
      parent,
      doc: document.text,
      extensions: [
        basicSetup,
        typst_lezer(),
        EditorView.lineWrapping,
        highlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromDocument))) {
            document.change(toTextChanges(update.changes), this);
          }
          if (update.selectionSet && update.view.hasFocus) options.onCursor?.(update.state.selection.main.head);
        }),
      ],
    });
    this.view.dom.dataset.testid = 'typst-source';
    this.unsubscribe = document.onChange((changes, origin) => {
      if (origin === this) return;
      this.view.dispatch({ changes: changes as ChangeSpec[], annotations: fromDocument.of(true) });
    });
  }

  /** Selects `from..to`, scrolls it into view and briefly highlights it. */
  reveal(from: number, to: number): void {
    const length = this.view.state.doc.length;
    const range = { from: Math.min(from, length), to: Math.min(to, length) };
    this.view.dispatch({
      selection: EditorSelection.single(range.from, range.to),
      effects: [setHighlight.of(range), EditorView.scrollIntoView(range.from, { y: 'center' })],
    });
    this.view.focus();
  }

  destroy(): void {
    this.unsubscribe();
    this.view.destroy();
  }
}

function toTextChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  // eslint-disable-next-line max-params -- callback signature is fixed by CodeMirror
  changes.iterChanges((from, to, _fromB, _toB, inserted) => result.push({ from, to, insert: inserted.toString() }));
  return result;
}
