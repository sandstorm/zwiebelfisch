// See Languages in languages.ts.
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import type { LanguagesHost, TextDocument } from './languages';

/**
 * Runs the paste edit providers around copy, cut and paste in a CodeMirror editor. A copy or cut adds to the clipboard
 * after CodeMirror's own handler (on the content, inside the outer element listened to) has set the text. A paste:
 * CodeMirror's transaction (`input.paste`) is replaced by one (a transaction filter) that puts the providers' text in
 * and makes their additional edits, so one undo takes back all. A paste of different texts at several cursors (a line
 * each) stays as it is. `languageId`: the text's language; `path`: the file it is in, now (null: none, no providers).
 */
export function pasteExtension(
  edits: Pick<LanguagesHost, 'prepareDocumentPaste' | 'provideDocumentPasteEdits'>,
  languageId: string,
  path: () => ProjectPath | null,
): Extension {
  const documentOf = (state: EditorState): TextDocument | null => {
    const file = path();
    return file === null ? null : { path: file, languageId, text: state.doc.toString() };
  };
  // the clipboard of the paste being dispatched; null: no paste
  let pasted: DataTransfer | null = null;
  return [
    ViewPlugin.define((view) => {
      const copy = (event: ClipboardEvent) => {
        const data = event.clipboardData;
        const copied = data?.getData('text/plain') ?? '';
        const document = documentOf(view.state);
        if (data && document && copied !== '') edits.prepareDocumentPaste(document, copied, data);
      };
      view.dom.addEventListener('copy', copy);
      view.dom.addEventListener('cut', copy);
      return {
        destroy: () => {
          view.dom.removeEventListener('copy', copy);
          view.dom.removeEventListener('cut', copy);
        },
      };
    }),
    EditorView.domEventHandlers({
      paste: (event) => {
        pasted = event.clipboardData;
        return false;
      },
    }),
    EditorState.transactionFilter.of((tr) => {
      const data = pasted;
      if (data === null || !tr.docChanged || !tr.isUserEvent('input.paste')) return tr;
      pasted = null;
      const document = documentOf(tr.startState);
      const ranges: SourceRange[] = [];
      const texts = new Set<string>();
      tr.changes.iterChangedRanges((from, to, fromB, toB) => {
        ranges.push(SourceRange.of({ from, to }));
        texts.add(tr.newDoc.sliceString(fromB, toB));
      });
      if (document === null || texts.size !== 1) return tr;
      const { insertText, additionalEdits } = edits.provideDocumentPasteEdits(document, ranges, [...texts][0], data);
      const changes = tr.startState.changes([...additionalEdits, ...ranges.map(({ from, to }) => ({ from, to, insert: insertText }))]);
      const cursors = ranges.map(({ to }) => EditorSelection.cursor(changes.mapPos(to, 1)));
      return { changes, selection: EditorSelection.create(cursors, Math.min(tr.selection?.mainIndex ?? 0, cursors.length - 1)), userEvent: 'input.paste', scrollIntoView: true };
    }),
  ];
}
