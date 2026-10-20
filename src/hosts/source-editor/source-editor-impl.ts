// See SourceEditorContributions in source-editor.ts.
import { Compartment, EditorSelection, StateEffect, StateField, type ChangeSet, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { SourceRange, type TextChange, type TypstDocument } from '../../core/typst-document/typst-document';
import css from './source-editor.css?inline';
import { type SourceEditorContributions, type CodeMirrorContext, type CodeMirrorSelector, fromDocument, type SourceEditorOptions } from './source-editor';

/** The `SourceEditorContributions` of one widget, which makes its Source editors (`createEditor`) and applies the contributions to them. */
export class SourceEditorHost implements SourceEditorContributions {
  private readonly registered: { readonly selector: CodeMirrorSelector; readonly extension: Extension | ((editor: CodeMirrorContext) => Extension) }[] = [];
  private readonly changed = new EventEmitter<void>();
  /** The CSS of the editors (a revealed range), for the widget to put where the widget renders. */
  readonly styleSheet: string = css;

  registerCodeMirrorExtension(selector: CodeMirrorSelector, extension: Extension | ((editor: CodeMirrorContext) => Extension)): Disposable {
    const entry = { selector, extension };
    this.registered.push(entry);
    this.changed.fire();
    return new Disposable(() => {
      this.registered.splice(this.registered.indexOf(entry), 1);
      this.changed.fire();
    });
  }

  codeMirrorExtensionsFor(editor: CodeMirrorContext): Extension {
    const compartment = new Compartment();
    const follow = ViewPlugin.define((view) => {
      const subscription = this.changed.event(() => view.dispatch({ effects: compartment.reconfigure(this.selected(editor)) }));
      return { destroy: () => subscription.dispose() };
    });
    return [compartment.of(this.selected(editor)), follow];
  }

  /** A Source editor of `document` in `parent`, with every contribution for it registered now or later. */
  createEditor(parent: HTMLElement, document: TypstDocument, options: SourceEditorOptions = {}): SourceEditor {
    const contributed = this.codeMirrorExtensionsFor({ editor: 'source', languageId: 'typst', path: () => options.path?.() ?? null, document });
    return new SourceEditor(parent, document, options, contributed);
  }

  private selected(editor: CodeMirrorContext): Extension {
    return this.registered
      .filter(({ selector }) => selects(selector, editor))
      .map(({ extension }) => (typeof extension === 'function' ? extension(editor) : extension));
  }
}

/**
 * The plain-Typst editor of one document: a bare CodeMirror (no keymap beyond CodeMirror's defaults, no history)
 * with the contributions, its text and selection in sync with the document. Made by `SourceEditorHost.createEditor`.
 */
export class SourceEditor {
  private readonly view: EditorView;
  private readonly subscription: Disposable;

  constructor(parent: HTMLElement, document: TypstDocument, options: SourceEditorOptions, contributed: Extension) {
    this.view = new EditorView({
      parent,
      doc: document.text,
      extensions: [
        contributed,
        highlightField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromDocument))) {
            document.change(toTextChanges(update.changes), this);
          }
          reportSelection(update, options);
        }),
      ],
    });
    this.view.dom.dataset.testid = 'zwf-source';
    this.subscription = document.onDidChange(({ contentChanges, origin }) => {
      if (origin !== this) this.view.dispatch({ changes: [...contentChanges], annotations: fromDocument.of({ origin }) });
    });
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
    this.subscription.dispose();
    this.view.destroy();
  }
}

function selects({ language, editor }: CodeMirrorSelector, context: CodeMirrorContext): boolean {
  return (language === undefined || language === context.languageId) && (editor === undefined || editor === context.editor);
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
      range ? Decoration.set(Decoration.mark({ class: 'zwf-source__jump' }).range(range.from, range.to)) : Decoration.none,
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
