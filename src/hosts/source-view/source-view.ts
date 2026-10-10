// SourceView: the CodeMirror 6 editing view of a TypstDocument. Entry of hosts/source-view/.
// See ARCHITECTURE.md, "SourceView".
import { basicSetup } from 'codemirror';
import { setDiagnostics } from '@codemirror/lint';
import { Annotation, EditorSelection, StateEffect, StateField, Transaction, type ChangeSet, type ChangeSpec } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { type Highlight, type Presence, type PresenceTarget, REMOTE_ORIGIN, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import type { DocumentLinkProvider } from '../../core/document-links/document-links';
import { codeColors } from './code-colors';
import { documentLinks } from './file-links';
import { toLintDiagnostics, type SourceDiagnostic } from './lint';
import { remotePresence, showPresence } from './presence';
import { typstLanguage } from './typst-language';

export { codeColors, isLightText } from './code-colors';
export { describeDiagnostic, type SourceDiagnostic } from './lint';
export { documentLinks, linkInfo } from './file-links';
export { remotePresence, showPresence } from './presence';
export { typstLanguage } from './typst-language';

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

/** Tells `options` about a moved selection (after the view has it), and about the focused cursor. */
function reportSelection(update: ViewUpdate, options: SourceViewOptions): void {
  if (update.selectionSet && update.view.hasFocus) options.onCursor?.(update.state.selection.main.head);
  if (update.selectionSet || update.docChanged) options.onSelection?.();
}

export interface SourceViewOptions {
  /** Called with the cursor offset whenever the selection moves. */
  onCursor?(offset: number): void;
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
  /** Makes file paths in the code open their file (Mod+click, Alt+Enter, tooltip); default: plain text. */
  documentLinks?: DocumentLinkProvider;
}

/**
 * The plain-Typst editing view (CodeMirror 6), kept in sync with a
 * TypstDocument in both directions.
 */
export class SourceView implements PresenceTarget {
  private readonly view: EditorView;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions = {}) {
    this.view = new EditorView({
      parent,
      doc: document.text,
      extensions: [
        basicSetup,
        codeColors,
        typstLanguage(),
        EditorView.lineWrapping,
        highlightField,
        layersField,
        remotePresence,
        options.documentLinks ? documentLinks(options.documentLinks) : [],
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromDocument))) {
            document.change(toTextChanges(update.changes), this);
          }
          reportSelection(update, options);
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

  /** Shows other users' carets and selections (replacing those shown before); they follow edits. */
  setPresence(presences: readonly Presence[]): void {
    showPresence(this.view, presences);
  }

  /** The selected source range (the main selection). */
  selection(): { from: number; to: number } {
    const { from, to } = this.view.state.selection.main;
    return { from, to };
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

