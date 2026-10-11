// The devtools' Document tab. See DevtoolsPanel in devtools-panel.ts.
import type { SourceRange } from '../../../core/typst-document/typst-document';
import type { DocumentRow } from '../model/document-tree';
import { element, type Tab } from './dom';

/**
 * The shown file's ProseMirror document as a tree, each node with its source range; a click selects a node's source.
 */
export class DocumentTab implements Tab {
  readonly element: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly document: () => ShownDocument,
    /** Shows `range` of the shown file in its editor. */
    private readonly reveal: (range: SourceRange) => void,
  ) {
    this.element = element(doc, 'div', '');
  }

  update(): void {
    const shown = this.document();
    const header = element(this.doc, 'p', 'typst-devtools__note', shown.path);
    if (shown.kind === 'none') return this.element.replaceChildren(header, element(this.doc, 'p', 'typst-devtools__note', shown.reason));
    const list = element(this.doc, 'ol', 'typst-devtools__tree');
    for (const row of shown.rows) list.append(this.#row(row, shown));
    header.append(` · selection ${shown.selection.from}–${shown.selection.to} · ${shown.rows.length} nodes`);
    this.element.replaceChildren(header, list);
  }

  #row(row: DocumentRow, shown: Extract<ShownDocument, { kind: 'rows' }>): HTMLElement {
    const item = element(this.doc, 'li', 'typst-devtools__row');
    const { from, to } = shown.selection;
    if (row.pos <= from && to <= row.end) item.classList.add('typst-devtools__row--selected');
    const button = item.appendChild(element(this.doc, 'button', 'typst-devtools__node'));
    button.style.paddingInlineStart = `${4 + row.depth * 12}px`;
    button.append(
      element(this.doc, 'span', 'typst-devtools__name', row.name),
      element(this.doc, 'span', 'typst-devtools__range', `${row.range.from}–${row.range.to}`),
      ...(row.box ? [element(this.doc, 'span', 'typst-devtools__badge', 'box')] : []),
      ...row.marks.map((mark) => element(this.doc, 'span', 'typst-devtools__mark', mark)),
      element(this.doc, 'span', 'typst-devtools__detail', row.detail),
    );
    button.title = [`${row.name}: pos ${row.pos}–${row.end}, source ${row.range.from}–${row.range.to}`, row.attributes, `source: ${shown.source(row.range)}`].filter(Boolean).join('\n');
    button.addEventListener('click', () => this.reveal(row.range));
    return item;
  }
}

/** The document of the shown file: its rows and the selection (positions), or why there are none. */
export type ShownDocument =
  | { readonly kind: 'rows'; readonly path: string; readonly rows: readonly DocumentRow[]; readonly selection: { from: number; to: number }; source(range: SourceRange): string }
  | { readonly kind: 'none'; readonly path: string; readonly reason: string };
