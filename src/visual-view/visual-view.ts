import { Editor } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { TypstDocument } from '../document/typst-document';
import { extensions } from './extensions';
import { print, project, sourceToPos, syncDoc } from './projection';
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
      extensions,
      injectCSS: false,
      editorProps: { attributes: { class: 'typst-visual', 'data-testid': 'typst-visual' } },
      onTransaction: ({ transaction }) => this.afterTransaction(transaction),
    });
    // Load the projection itself (not a JSON copy): its node identities are
    // what marks blocks as untouched.
    const { state } = this.editor;
    this.editor.view.updateState(
      EditorState.create({ schema: state.schema, doc: project(document.text, state.schema), plugins: state.plugins }),
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
