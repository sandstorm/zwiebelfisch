// The Visual views the devtools read the projection from: a Tiptap extension in every view (through the public
// `visualView.registerTiptapExtension`) keeps each view's editor by its document. See ../devtools.ts.
import { Extension, type Editor } from '@tiptap/core';
import type { VisualViewContext } from '../../../src';
import { projectionRows, type ProjectionRow } from '../model/projection-tree';

type TypstDocument = VisualViewContext['document'];

/** The Visual views alive now, by document; `onChange` hears every transaction of any of them. */
export class ProjectionViews {
  readonly #views = new Map<TypstDocument, { editor: Editor; view: VisualViewContext }>();

  constructor(private readonly onChange: () => void) {}

  /** For `visualView.registerTiptapExtension`: the extension that reports its view. */
  readonly tiptapExtension = (view: VisualViewContext) => {
    const views = this.#views;
    const onChange = this.onChange;
    return Extension.create({
      name: 'devtoolsProjection',
      onCreate() {
        views.set(view.document, { editor: this.editor, view });
        onChange();
      },
      onTransaction() {
        onChange();
      },
      onDestroy() {
        if (views.get(view.document)?.editor === this.editor) views.delete(view.document);
      },
    });
  };

  /** The rows of `document`'s Visual view and its selection (positions); null while it has none. */
  rows(document: TypstDocument): { rows: ProjectionRow[]; selection: { from: number; to: number } } | null {
    const entry = this.#views.get(document);
    if (!entry) return null;
    const { doc, selection } = entry.editor.state;
    const { view } = entry;
    const rows = projectionRows(doc, { posToSource: (pos, bias) => view.posToSource(doc, pos, bias), isBox: (node) => view.isBox(node) });
    return { rows, selection: { from: selection.from, to: selection.to } };
  }
}
