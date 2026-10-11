// The imports extension in the Source editor. See imports in ../imports.ts.
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { addCopyListener, type ImportsClipboard } from '../imports';
import type { CopiedImport } from '../model/pasted-imports';

/**
 * Copies from the editor carry the imports they use; a paste gets the imports it needs as changes of the paste's own
 * transaction (a transaction filter), so one undo takes back both.
 */
export function sourceEditorImports(document: TypstDocument, clipboard: ImportsClipboard): Extension {
  // what the clipboard of the paste being dispatched brought; null: no paste
  let pasted: CopiedImport[] | null = null;
  return [
    // on the outer element: CodeMirror's own copy handler, on the content inside it, has set the text by then
    ViewPlugin.define((view) => ({ destroy: addCopyListener(view.dom, document, clipboard) })),
    EditorView.domEventHandlers({
      paste: (event) => {
        pasted = event.clipboardData ? clipboard.paste(event.clipboardData) : [];
        return false;
      },
    }),
    EditorState.transactionFilter.of((tr) => {
      const copied = pasted;
      if (copied === null || !tr.docChanged || !tr.isUserEvent('input.paste')) return tr;
      pasted = null;
      const changes = clipboard.changes(document, tr.startState.doc.toString(), tr.newDoc.toString(), copied);
      return [tr, ...changes.map((change) => ({ changes: change, sequential: true }))];
    }),
  ];
}
