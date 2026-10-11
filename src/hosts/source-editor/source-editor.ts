// SourceEditorHost. Entry of hosts/source-editor/. See docs/30_architecture/05_source-editor.typ.
import { basicSetup } from 'codemirror';
import {
  Annotation, Compartment, EditorSelection, StateEffect, StateField, type ChangeSet, type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, type ViewUpdate } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import css from './source-editor.css?inline';

/**
 * Makes Source editors and keeps the registered contributions applied to all of them.
 *
 * Makes the Source editors (CodeMirror bound to a TypstDocument) and applies what is contributed to them.
 *
 * Why a host: the Source editor itself only keeps text and selection in sync with its document (plus reveal).
 * Everything else — the Typst language, colors, lint, document links, other users' carets — is a contribution,
 * registered once and applied to every editor made before or after, so a feature never tracks editors.
 */
export class SourceEditorHost implements SourceEditorContributions {
  private readonly extensions: (Extension | ((view: SourceEditorContext) => Extension))[] = [];
  private readonly changed = new EventEmitter<void>();
  /** How a view gets its contributions: it asks for them now and again on every change. */
  private readonly contributions: Contributions = {
    extensionsFor: (view) => this.extensionsFor(view),
    onDidChange: this.changed.event,
  };
  /** The CSS of the views (a revealed range), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  registerCodeMirrorExtension(extension: Extension | ((view: SourceEditorContext) => Extension)): Disposable {
    this.extensions.push(extension);
    this.changed.fire();
    return new Disposable(() => {
      this.extensions.splice(this.extensions.indexOf(extension), 1);
      this.changed.fire();
    });
  }

  /** A Source editor of `document` in `parent`, with every contribution registered now or later. */
  createView(parent: HTMLElement, document: TypstDocument, options: SourceEditorOptions = {}): SourceEditor {
    return new SourceEditor(parent, document, options, this.contributions);
  }

  private extensionsFor(view: SourceEditorContext): Extension {
    return this.extensions.map((extension) => (typeof extension === 'function' ? extension(view) : extension));
  }
}

/** The Source editor's contribution points (what `ExtensionContext.sourceEditor` offers). */
export interface SourceEditorContributions {
  /**
   * Adds CodeMirror extensions to every Source editor, the existing ones included, until disposed: the same value for
   * all of them, or made per view from what the view shows (`SourceEditorContext`).
   */
  registerCodeMirrorExtension(extension: Extension | ((view: SourceEditorContext) => Extension)): Disposable;
}

/** What a contribution knows about the one Source editor it is applied to. */
export interface SourceEditorContext {
  /** The document the view edits. */
  readonly document: TypstDocument;
}

/**
 * Marks a Source editor's transactions that mirror a change of its document made elsewhere (another view, the API,
 * another user), with that change's origin. The view does not send them back; a contribution may look at the origin,
 * e.g. to keep some changes out of the undo history (`EditorState.transactionExtender`).
 */
export const fromDocument = Annotation.define<{ readonly origin: unknown }>();

export interface SourceEditorOptions {
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
}

/**
 * The view type of the Source editor's custom editor, for `workbench.open(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeCustomEditorId`.
 */
export const SOURCE_EDITOR = 'sourceEditor';

/**
 * The plain-Typst editing view (CodeMirror 6), kept in sync with a
 * TypstDocument in both directions. Made by `SourceEditorHost.createView`.
 */
export class SourceEditor {
  private readonly view: EditorView;
  private readonly contributed = new Compartment();
  private readonly subscriptions: Disposable[];

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceEditorOptions, contributions: Contributions) {
    const context: SourceEditorContext = { document };
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
        if (origin !== this) this.view.dispatch({ changes: [...contentChanges], annotations: fromDocument.of({ origin }) });
      }),
      contributions.onDidChange(() => this.view.dispatch({ effects: this.contributed.reconfigure(contributions.extensionsFor(context)) })),
    ];
  }

  /** Selects `range`, scrolls it into view and highlights it until the text changes or the selection moves. */
  reveal({ from, to }: SourceRange): void {
    const length = this.view.state.doc.length;
    const range = { from: Math.min(from, length), to: Math.min(to, length) };
    this.view.dispatch({
      selection: EditorSelection.single(range.from, range.to),
      effects: [setHighlight.of(range), EditorView.scrollIntoView(range.from, { y: 'center' })],
    });
    this.view.focus();
  }

  /** Puts `text` in place of the selection, the cursor after it, scrolled into view; focuses the editor. */
  insert(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
    this.view.focus();
  }

  /** The selected source range (the main selection). */
  selection(): SourceRange {
    return SourceRange.of(this.view.state.selection.main);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.view.destroy();
  }
}

/** What a view needs from its host: the contributed extensions for it, and word when they change. */
interface Contributions {
  extensionsFor(view: SourceEditorContext): Extension;
  readonly onDidChange: Event<void>;
}

const highlightField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(range, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlight)) return effect.value.from < effect.value.to ? effect.value : null;
    }
    if (!range || tr.docChanged) return null;
    const selected = tr.selection?.main ?? range;
    return selected.from === range.from && selected.to === range.to ? range : null;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (range) =>
      range ? Decoration.set(Decoration.mark({ class: 'typst-source__jump' }).range(range.from, range.to)) : Decoration.none,
    ),
});

/**
 * The range `reveal` highlights, while it is what the user looks at: it goes when the text changes (here or in
 * another view) or the selection moves away from it, so it never stays behind as a second selection.
 */
const setHighlight = StateEffect.define<{ from: number; to: number }>();

function toTextChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  // eslint-disable-next-line max-params -- callback signature is fixed by CodeMirror
  changes.iterChanges((from, to, _fromB, _toB, inserted) => result.push({ ...SourceRange.of({ from, to }), insert: inserted.toString() }));
  return result;
}

/** Tells `options` about a moved selection or changed text (after the view has it). */
function reportSelection(update: ViewUpdate, options: SourceEditorOptions): void {
  if (update.selectionSet || update.docChanged) options.onSelection?.();
}
