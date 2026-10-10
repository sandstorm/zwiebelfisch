// SourceView: one CodeMirror 6 editor bound to a TypstDocument, with what its host contributes. See source-view.ts.
import { basicSetup } from 'codemirror';
import { Annotation, Compartment, EditorSelection, StateEffect, StateField, Transaction, type ChangeSet, type ChangeSpec, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import { REMOTE_ORIGIN, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import type { SourceViewContext } from './contribution';

export interface SourceViewOptions {
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
}

/** What a view needs from its host: the contributed extensions for it, and word when they change. */
export interface Contributions {
  extensionsFor(view: SourceViewContext): Extension;
  readonly onDidChange: Event<void>;
}

/**
 * The plain-Typst editing view (CodeMirror 6), kept in sync with a
 * TypstDocument in both directions. Made by `SourceViewHost.createView`.
 */
export class SourceView {
  private readonly view: EditorView;
  private readonly contributed = new Compartment();
  private readonly subscriptions: Disposable[];

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions, contributions: Contributions) {
    const context: SourceViewContext = { document };
    this.view = new EditorView({
      parent,
      doc: document.text,
      extensions: [
        basicSetup,
        this.contributed.of(contributions.extensionsFor(context)),
        EditorView.lineWrapping,
        highlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromDocument))) {
            document.change(toTextChanges(update.changes), this);
          }
          reportSelection(update, options);
        }),
      ],
    });
    this.view.dom.dataset.testid = 'typst-source';
    const unsubscribe = document.onChange((changes, origin) => {
      if (origin === this) return;
      // Undo is per user: collaborators' edits never enter this view's history (it maps over them).
      const annotations = [fromDocument.of(true), ...(origin === REMOTE_ORIGIN ? [Transaction.addToHistory.of(false)] : [])];
      this.view.dispatch({ changes: changes as ChangeSpec[], annotations });
    });
    this.subscriptions = [
      new Disposable(unsubscribe),
      contributions.onDidChange(() => this.view.dispatch({ effects: this.contributed.reconfigure(contributions.extensionsFor(context)) })),
    ];
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

  /** The selected source range (the main selection). */
  selection(): { from: number; to: number } {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
  }

  destroy(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.view.destroy();
  }
}

/** Marks transactions that mirror a document change, so they are not sent back. */
const fromDocument = Annotation.define<boolean>();

/** The range `reveal` highlights, until the next reveal; it follows edits. */
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

/** Tells `options` about a moved selection or changed text (after the view has it). */
function reportSelection(update: ViewUpdate, options: SourceViewOptions): void {
  if (update.selectionSet || update.docChanged) options.onSelection?.();
}

function toTextChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  // eslint-disable-next-line max-params -- callback signature is fixed by CodeMirror
  changes.iterChanges((from, to, _fromB, _toB, inserted) => result.push({ from, to, insert: inserted.toString() }));
  return result;
}
