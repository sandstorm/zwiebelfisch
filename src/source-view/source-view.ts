import { basicSetup } from 'codemirror';
import { setDiagnostics } from '@codemirror/lint';
import { getOriginalDoc, unifiedMergeView, updateOriginalDoc } from '@codemirror/merge';
import { Annotation, Compartment, EditorSelection, StateEffect, StateField, Transaction, type ChangeSet, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { Highlight } from '../document/highlight';
import { REMOTE_ORIGIN, type TextChange, type TypstDocument } from '../document/typst-document';
import { toLintDiagnostics, type SourceDiagnostic } from './lint';
import { typstLanguage } from './typst-language';

export { describeDiagnostic, type SourceDiagnostic } from './lint';

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

/** Highlights by layer (one per feature, e.g. remote cursors), each layer replaced as a whole. */
const setLayer = StateEffect.define<{ layer: string; highlights: readonly Highlight[] }>();
const layersField = StateField.define<Record<string, DecorationSet>>({
  create: () => ({}),
  update(layers, tr) {
    let next = tr.docChanged ? mapLayers(layers, tr.changes) : layers;
    for (const effect of tr.effects) {
      if (effect.is(setLayer)) next = { ...next, [effect.value.layer]: toDecorations(effect.value.highlights, tr.newDoc.length) };
    }
    return next;
  },
  provide: (field) => EditorView.decorations.computeN([field], (state) => Object.values(state.field(field))),
});

function mapLayers(layers: Record<string, DecorationSet>, changes: ChangeSet): Record<string, DecorationSet> {
  return Object.fromEntries(Object.entries(layers).map(([layer, set]) => [layer, set.map(changes)]));
}

function toDecorations(highlights: readonly Highlight[], length: number): DecorationSet {
  const ranges = highlights
    .map((h) => ({ ...h, from: Math.min(h.from, length), to: Math.min(h.to, length) }))
    .filter((h) => h.from < h.to)
    .map((h) => Decoration.mark({ class: h.className, attributes: h.attributes }).range(h.from, h.to));
  return Decoration.set(ranges, true);
}

export interface SourceViewOptions {
  /** Called with the cursor offset whenever the selection moves. */
  onCursor?(offset: number): void;
  /** Called with the new base text when the user accepts a change shown by `showChanges`. */
  onBaseChange?(base: string): void;
}

/**
 * The plain-Typst editing view (CodeMirror 6), kept in sync with a
 * TypstDocument in both directions.
 */
export class SourceView {
  private readonly view: EditorView;
  private readonly unsubscribe: () => void;
  private readonly changes = new Compartment();
  private base: string | null = null;

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions = {}) {
    this.view = new EditorView({
      parent,
      doc: document.text,
      extensions: [
        basicSetup,
        typstLanguage(),
        EditorView.lineWrapping,
        highlightField,
        layersField,
        this.changes.of([]),
        EditorView.updateListener.of((update) => {
          if (update.transactions.some((tr) => tr.effects.some((effect) => effect.is(updateOriginalDoc)))) {
            this.base = getOriginalDoc(update.state).toString();
            options.onBaseChange?.(this.base);
          }
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
      // Undo is per user: collaborators' edits never enter this view's history (it maps over them).
      const annotations = [fromDocument.of(true), ...(origin === REMOTE_ORIGIN ? [Transaction.addToHistory.of(false)] : [])];
      this.view.dispatch({ changes: changes as ChangeSpec[], annotations });
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

  /**
   * Shows compiler diagnostics for the current text (underline + hover with
   * hints), replacing the previous ones. They follow later edits.
   */
  setDiagnostics(diagnostics: SourceDiagnostic[]): void {
    const { state } = this.view;
    this.view.dispatch(setDiagnostics(state, toLintDiagnostics(diagnostics, state.doc.length)));
  }

  /** Replaces the highlights of `layer`; they follow edits until set again. */
  setHighlights(layer: string, highlights: readonly Highlight[]): void {
    this.view.dispatch({ effects: setLayer.of({ layer, highlights }) });
  }

  /** The selected source range (the main selection). */
  selection(): { from: number; to: number } {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
  }

  /**
   * Shows an inline diff against `base` (earlier Typst source), with accept /
   * reject buttons per changed chunk, until called with null. Rejecting edits
   * the document; accepting moves the base (see `onBaseChange`).
   */
  showChanges(base: string | null): void {
    if (base === this.base) return;
    this.base = base;
    const extension = base === null ? [] : unifiedMergeView({ original: base, gutter: true, syntaxHighlightDeletions: true });
    this.view.dispatch({ effects: this.changes.reconfigure(extension) });
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

