// SourceViewHost: makes the Source views (CodeMirror bound to a TypstDocument) and applies what is contributed to
// them. Entry of hosts/source-view/. See ARCHITECTURE.md, "SourceView", and docs/2026_10_10_extensions-architecture.md.
// Why a host: the Source view itself only keeps text and selection in sync with its document (plus reveal).
// Everything else — the Typst language, colors, lint, document links, other users' carets — is a
// contribution, registered once and applied to every view made before or after, so a feature never tracks views.
import { basicSetup } from 'codemirror';
import {
  Annotation, Compartment, EditorSelection, StateEffect, StateField, type ChangeSet, type ChangeSpec, type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { TextChange, TypstDocument } from '../../core/typst-document/typst-document';

/** The Source view's contribution points (what `ExtensionContext.sourceView` offers). */
export interface SourceViewContributions {
  /**
   * Adds CodeMirror extensions to every Source view, the existing ones included, until disposed: the same value for
   * all of them, or made per view from what the view shows (`SourceViewContext`).
   */
  registerCodeMirrorExtension(extension: Extension | ((view: SourceViewContext) => Extension)): Disposable;
}

/** Makes Source views and keeps the registered contributions applied to all of them. */
export class SourceViewHost implements SourceViewContributions {
  private readonly extensions: (Extension | ((view: SourceViewContext) => Extension))[] = [];
  private readonly changed = new EventEmitter<void>();
  /** How a view gets its contributions: it asks for them now and again on every change. */
  private readonly contributions: Contributions = {
    extensionsFor: (view) => this.extensionsFor(view),
    onDidChange: this.changed.event,
  };

  registerCodeMirrorExtension(extension: Extension | ((view: SourceViewContext) => Extension)): Disposable {
    this.extensions.push(extension);
    this.changed.fire();
    return new Disposable(() => {
      this.extensions.splice(this.extensions.indexOf(extension), 1);
      this.changed.fire();
    });
  }

  /** A Source view of `document` in `parent`, with every contribution registered now or later. */
  createView(parent: HTMLElement, document: TypstDocument, options: SourceViewOptions = {}): SourceView {
    return new SourceView(parent, document, options, this.contributions);
  }

  private extensionsFor(view: SourceViewContext): Extension {
    return this.extensions.map((extension) => (typeof extension === 'function' ? extension(view) : extension));
  }
}

/** What a contribution knows about the one Source view it is applied to. */
export interface SourceViewContext {
  /** The document the view edits. */
  readonly document: TypstDocument;
}

/**
 * Marks a Source view's transactions that mirror a change of its document made elsewhere (another view, the API,
 * another user), with that change's origin. The view does not send them back; a contribution may look at the origin,
 * e.g. to keep some changes out of the undo history (`EditorState.transactionExtender`).
 */
export const fromDocument = Annotation.define<{ readonly origin: unknown }>();

export interface SourceViewOptions {
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
}

/** What a view needs from its host: the contributed extensions for it, and word when they change. */
interface Contributions {
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
    this.subscriptions = [
      document.onDidChange(({ contentChanges, origin }) => {
        if (origin !== this) this.view.dispatch({ changes: contentChanges as ChangeSpec[], annotations: fromDocument.of({ origin }) });
      }),
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

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.view.destroy();
  }
}

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
