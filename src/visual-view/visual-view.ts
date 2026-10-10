import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { TypstDocument } from '../document/typst-document';
import { locate, print, project, syncBlocks } from './projection';
import { schema } from './schema';

/** Marks transactions that mirror a document change, so they are not written back. */
const FROM_DOCUMENT = 'typst-from-document';

/**
 * The Word-like editing view (ProseMirror), a projection of a TypstDocument.
 *
 * Visual edits become one minimal text change on the document; document
 * changes from elsewhere are re-projected and only the differing top-level
 * blocks are replaced. Unmodelled Typst shows as raw boxes and is never
 * rewritten.
 */
export class VisualView {
  private readonly view: EditorView;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, private readonly document: TypstDocument) {
    this.view = new EditorView(parent, {
      state: EditorState.create({
        doc: project(document.text),
        plugins: [
          history(),
          keymap({
            'Mod-z': undo,
            'Mod-y': redo,
            'Shift-Mod-z': redo,
            'Mod-b': toggleMark(schema.marks.strong),
            'Mod-i': toggleMark(schema.marks.emph),
          }),
          keymap(baseKeymap),
        ],
      }),
      attributes: { class: 'typst-visual', 'data-testid': 'typst-visual' },
      dispatchTransaction: (tr) => this.apply(tr),
    });
    this.unsubscribe = document.onChange((_changes, origin) => {
      if (origin !== this) this.syncFromDocument();
    });
  }

  /** Selects the block containing source offset `from` and scrolls to it. */
  reveal(from: number, _to: number): void {
    const { doc } = this.view.state;
    const $pos = doc.resolve(locate(doc, from));
    const block = $pos.node(1);
    const start = $pos.before(1);
    const selection = TextSelection.between(doc.resolve(start + 1), doc.resolve(start + block.nodeSize - 1));
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
    this.view.focus();
  }

  destroy(): void {
    this.unsubscribe();
    this.view.destroy();
  }

  private apply(tr: Transaction): void {
    this.view.updateState(this.view.state.apply(tr));
    if (!tr.docChanged || tr.getMeta(FROM_DOCUMENT)) return;
    this.document.setText(print(this.view.state.doc), this);
  }

  private syncFromDocument(): void {
    const tr = syncBlocks(this.view.state.tr, project(this.document.text));
    if (tr.docChanged) this.view.dispatch(tr.setMeta(FROM_DOCUMENT, true).setMeta('addToHistory', false));
  }
}
