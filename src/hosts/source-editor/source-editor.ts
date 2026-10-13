import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import {
  Annotation, Compartment, EditorSelection, StateEffect, StateField, type ChangeSet, type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import { followColorScheme, highlightStyle } from './code-colors';
import css from './source-editor.css?inline';

/**
 * Makes the Source editors (CodeMirror 6 bound to a `TypstDocument`) and applies what extensions contribute to them.
 *
 * The Source editor shows a Typst file as plain text. It is one of the two built-in custom editors for `*.typ`, next
 * to the Visual editor; the workbench registers both (`TypstEditors`) and calls `createEditor`. The editor itself
 * keeps only the mechanism: text and selection in sync with the document both ways, reveal, selection reporting.
 * Its look is `codeColors`, CodeMirror's default in the widget's light or dark scheme, which every CodeMirror in the
 * widget uses (raw boxes, the text files' editor). Everything else is a CodeMirror extension someone contributes: the
 * Typst language, the diagnostics, other users' carets, the document links (the workbench's). A contribution is
 * registered once and applies to every editor, open or made later, so no feature tracks editors. What is not about
 * Typst (shown whitespace) is shared with every CodeMirror in the widget that takes the shared ones
 * (`createSharedCodeMirrorExtension`: the raw boxes, the text files' editor). Undo is CodeMirror's history; a
 * contribution decides what stays out of it (`fromDocument`). See docs/40_architecture/05_source-editor.typ.
 */
export class SourceEditorHost implements SourceEditorContributions {
  private readonly extensions: (Extension | ((editor: SourceEditorContext) => Extension))[] = [];
  private readonly shared: Extension[] = [];
  private readonly changed = new EventEmitter<void>();
  /** How an editor gets its contributions: it asks for them now and again on every change. */
  private readonly contributions: Contributions = {
    extensionsFor: (editor) => this.extensionsFor(editor),
    onDidChange: this.changed.event,
  };
  /** The CSS of the editors (a revealed range), for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable {
    return this.add(this.extensions, extension);
  }

  registerSharedCodeMirrorExtension(extension: Extension): Disposable {
    return this.add(this.shared, extension);
  }

  createSharedCodeMirrorExtension(): Extension {
    const compartment = new Compartment();
    const follow = ViewPlugin.define((view) => {
      const subscription = this.changed.event(() => view.dispatch({ effects: compartment.reconfigure([...this.shared]) }));
      return { destroy: () => subscription.dispose() };
    });
    return [compartment.of([...this.shared]), follow];
  }

  /** A Source editor of `document` in `parent`, with every contribution registered now or later. */
  createEditor(parent: HTMLElement, document: TypstDocument, options: SourceEditorOptions = {}): SourceEditor {
    return new SourceEditor(parent, document, options, this.contributions);
  }

  private extensionsFor(editor: SourceEditorContext): Extension {
    return [...this.shared, ...this.extensions.map((extension) => (typeof extension === 'function' ? extension(editor) : extension))];
  }

  private add<T>(list: T[], extension: T): Disposable {
    list.push(extension);
    this.changed.fire();
    return new Disposable(() => {
      list.splice(list.indexOf(extension), 1);
      this.changed.fire();
    });
  }
}

/** The Source editor's contribution points (what `ExtensionContext.sourceEditor` offers). */
export interface SourceEditorContributions {
  /**
   * Adds CodeMirror extensions to every Source editor, the existing ones included, until disposed: the same value for
   * all of them, or made per editor from what the editor shows (`SourceEditorContext`).
   */
  registerCodeMirrorExtension(extension: Extension | ((editor: SourceEditorContext) => Extension)): Disposable;
  /**
   * Adds a CodeMirror extension to every CodeMirror of the widget that shows text, not only Typst, the existing ones
   * included, until disposed: the Source editors, the raw boxes' code, and the editors that include
   * `createSharedCodeMirrorExtension()` (the text files'). For what fits any text (shown whitespace), never a language.
   */
  registerSharedCodeMirrorExtension(extension: Extension): Disposable;
  /**
   * What a CodeMirror made elsewhere (an extension's own editor) includes to get the shared extensions
   * (`registerSharedCodeMirrorExtension`), those registered now and later, until it is destroyed.
   */
  createSharedCodeMirrorExtension(): Extension;
}

/** What a contribution knows about the one Source editor it is applied to. */
export interface SourceEditorContext {
  /** The document the editor edits. */
  readonly document: TypstDocument;
}

/**
 * Marks a Source editor's transactions that mirror a change of its document made elsewhere (another editor, the API,
 * another user), with that change's origin. The editor does not send them back; a contribution may look at the origin,
 * e.g. to keep some changes out of the undo history (`EditorState.transactionExtender`).
 */
export const fromDocument = Annotation.define<{ readonly origin: unknown }>();

export interface SourceEditorOptions {
  /** Called after the selection moved or the text changed; `selection()` already returns the new selection. */
  onSelection?(): void;
}

/**
 * CodeMirror's default look in the widget, for every CodeMirror in it (Source editors, raw boxes, other editors):
 * CodeMirror's default highlight style with its colors from the widget's `--te-syn-*` tokens, and CodeMirror's light
 * or dark theme (cursor, selection, gutters, panels, tooltips) following the widget's color scheme around the editor.
 */
export const codeColors: Extension = [syntaxHighlighting(highlightStyle), followColorScheme];

/**
 * The view type of the Source editor's custom editor, for `workbench.open(path, { viewType })`,
 * `TextEditor.viewType` and the menu context key `activeCustomEditorId`.
 */
export const SOURCE_EDITOR = 'sourceEditor';

/** The plain-Typst editor of one document. Made by `SourceEditorHost.createEditor`. */
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
        // Tab and Shift+Tab indent and outdent the selected lines; Escape, then Tab moves the focus on (CodeMirror's)
        keymap.of([indentWithTab]),
        codeColors,
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
    // focused first, as the Visual editor: who follows the selection of the focused editor (the preview) sees it move
    this.view.focus();
    this.view.dispatch({
      selection: EditorSelection.single(range.from, range.to),
      effects: [setHighlight.of(range), EditorView.scrollIntoView(range.from, { y: 'center' })],
    });
  }

  /** Puts `text` in place of the selection, the cursor after it, scrolled into view; focuses the editor. */
  insert(text: string): void {
    this.view.dispatch(this.view.state.replaceSelection(text), { scrollIntoView: true, userEvent: 'input' });
    this.view.focus();
  }

  /** Applies `changes` of the source (its coordinates now) as one transaction: one undo step. */
  edit(changes: readonly TextChange[]): void {
    this.view.dispatch({ changes: [...changes] });
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

/** What an editor needs from its host: the contributed extensions for it, and word when they change. */
interface Contributions {
  extensionsFor(editor: SourceEditorContext): Extension;
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
 * another editor) or the selection moves away from it, so it never stays behind as a second selection.
 */
const setHighlight = StateEffect.define<{ from: number; to: number }>();

function toTextChanges(changes: ChangeSet): TextChange[] {
  const result: TextChange[] = [];
  // eslint-disable-next-line max-params -- callback signature is fixed by CodeMirror
  changes.iterChanges((from, to, _fromB, _toB, inserted) => result.push({ ...SourceRange.of({ from, to }), insert: inserted.toString() }));
  return result;
}

/** Tells `options` about a moved selection or changed text (after the editor has it). */
function reportSelection(update: ViewUpdate, options: SourceEditorOptions): void {
  if (update.selectionSet || update.docChanged) options.onSelection?.();
}
