import { Editor } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Highlight } from '../document/highlight';
import type { TypstDocument } from '../document/typst-document';
import { changesPlugin, setChangesBase } from './change-decorations';
import { extensions } from './extensions';
import { highlights, setHighlights } from './highlights';
import { posToSource, print, project, sourceToPos, syncDoc } from './projection';
import { Toolbar } from './toolbar';

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'typst-from-document';

/**
 * The Word-like editing view (Tiptap/ProseMirror) with its formatting
 * toolbar, a projection of a TypstDocument.
 *
 * Visual edits become one minimal text change on the document; document
 * changes from elsewhere are re-projected and applied as the smallest
 * replacement, so the cursor stays where it was. Unmodelled Typst shows as
 * raw boxes and is never rewritten.
 */
export class VisualView {
  private readonly editor: Editor;
  private readonly toolbar: Toolbar;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, private readonly document: TypstDocument) {
    this.editor = new Editor({
      element: parent,
      extensions: [...extensions, highlights],
      injectCSS: false,
      editorProps: { attributes: { class: 'typst-visual', 'data-testid': 'typst-visual' } },
      onTransaction: ({ transaction }) => this.afterTransaction(transaction),
    });
    // Load the projection itself (not a JSON copy): its node identities are
    // what marks blocks as untouched.
    const { state } = this.editor;
    this.editor.view.updateState(
      EditorState.create({ schema: state.schema, doc: project(document.text, state.schema), plugins: [...state.plugins, changesPlugin] }),
    );
    this.toolbar = new Toolbar(parent, this.editor);
    this.unsubscribe = document.onChange((_changes, origin) => {
      if (origin !== this) this.syncFromDocument();
    });
  }

  /** Selects what shows source range `from`..`to` (a caret if empty) and scrolls to it. */
  reveal(from: number, to: number): void {
    const { doc } = this.editor.state;
    const anchor = sourceToPos(doc, from);
    const head = to > from ? Math.max(anchor, sourceToPos(doc, to, -1)) : anchor;
    const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(head));
    this.editor.view.dispatch(this.editor.state.tr.setSelection(selection).scrollIntoView());
    this.editor.view.focus();
  }

  /** Replaces the highlights of `layer` (source ranges); they follow edits until set again. */
  setHighlights(layer: string, ranges: readonly Highlight[]): void {
    this.editor.view.dispatch(setHighlights(this.editor.state.tr, layer, ranges));
  }

  /** The source range shown by the selection. */
  selection(): { from: number; to: number } {
    const { doc, selection } = this.editor.state;
    const from = posToSource(doc, selection.from);
    return { from, to: selection.empty ? from : Math.max(from, posToSource(doc, selection.to, -1)) };
  }

  /**
   * Shows what changed against `base` (an earlier Typst source) until called
   * with null: insertions highlighted, deletions struck through. Follows edits.
   */
  showChanges(base: string | null): void {
    this.editor.view.dispatch(setChangesBase(this.editor.state.tr, base));
  }

  destroy(): void {
    this.unsubscribe();
    this.toolbar.destroy();
    this.editor.destroy();
  }

  private afterTransaction(tr: Transaction): void {
    if (!tr.docChanged || tr.getMeta(FROM_DOCUMENT)) return;
    this.document.setText(print(this.editor.state.doc), this);
  }

  private syncFromDocument(): void {
    const { state } = this.editor;
    const tr = syncDoc(state.tr, project(this.document.text, state.schema));
    if (tr.docChanged) this.editor.view.dispatch(tr.setMeta(FROM_DOCUMENT, true).setMeta('addToHistory', false));
  }
}
