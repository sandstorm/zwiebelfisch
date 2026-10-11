// The Visual editors the devtools read the document from. See devtools in ../devtools.ts.
import { Extension, type Editor } from '@tiptap/core';
import type { VisualEditorContext } from '../../../hosts/visual-editor/visual-editor';
import { documentRows, type DocumentRow } from '../model/document-tree';

/**
 * The Visual editors loaded now (visible or hidden), by document; `onChange` hears every transaction of any of them.
 * `tiptapExtension`, registered in every Visual editor, keeps each one's Tiptap editor by its document.
 */
export class LoadedVisualEditors {
  readonly #editors = new Map<TypstDocument, { tiptap: Editor; editor: VisualEditorContext }>();

  constructor(private readonly onChange: () => void) {}

  /** For `visualEditor.registerTiptapExtension`: the extension that reports its editor. */
  readonly tiptapExtension = (editor: VisualEditorContext) => {
    const editors = this.#editors;
    const onChange = this.onChange;
    return Extension.create({
      name: 'devtoolsDocument',
      onCreate() {
        editors.set(editor.document, { tiptap: this.editor, editor });
        onChange();
      },
      onTransaction() {
        onChange();
      },
      onDestroy() {
        if (editors.get(editor.document)?.tiptap === this.editor) editors.delete(editor.document);
      },
    });
  };

  /** The rows of `document`'s Visual editor and its selection (positions); null while it has none. */
  rows(document: TypstDocument): { rows: DocumentRow[]; selection: { from: number; to: number } } | null {
    const entry = this.#editors.get(document);
    if (!entry) return null;
    const { doc, selection } = entry.tiptap.state;
    const { editor } = entry;
    const rows = documentRows(doc, { posToSource: (pos, bias) => editor.posToSource(doc, pos, bias), isBox: (node) => editor.isBox(node) });
    return { rows, selection: { from: selection.from, to: selection.to } };
  }
}

type TypstDocument = VisualEditorContext['document'];
