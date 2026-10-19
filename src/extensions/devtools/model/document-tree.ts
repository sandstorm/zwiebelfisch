// The Visual editor's ProseMirror document as rows, each with the source range it shows. See devtools in ../devtools.ts.
import type { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';
import { describeValue } from './describe';

/**
 * The rows of `doc`'s nodes in document order (depth first), with their source ranges through `mapping`.
 */
export function documentRows<N extends DocumentNode<N>>(doc: N, mapping: DocumentMapping<N>): DocumentRow[] {
  const rows: DocumentRow[] = [];
  const visit = (parent: N, start: number, depth: number) =>
    parent.forEach((node, offset) => {
      const pos = start + offset;
      rows.push(row(node, pos, depth, mapping));
      if (!node.isText) visit(node, pos + 1, depth + 1);
    });
  visit(doc, 0, 0);
  return rows;
}

/** A ProseMirror node, as far as the tree reads it (ProseMirror's `Node` is one). */
export interface DocumentNode<N> {
  readonly type: { readonly name: string };
  readonly attrs: Readonly<Record<string, unknown>>;
  readonly marks: readonly { readonly type: { readonly name: string } }[];
  readonly nodeSize: number;
  readonly isText: boolean;
  readonly text?: string;
  forEach(f: (node: N, offset: number) => void): void;
}

/** One node of the document. */
export interface DocumentRow {
  /** 0: a child of the document. */
  readonly depth: number;
  readonly name: string;
  /** Where it starts and ends in the document (ProseMirror positions). */
  readonly pos: number;
  readonly end: number;
  /** The source it shows. */
  readonly range: SourceRange;
  /** It shows as a box of its own (raw Typst, an image, a margin note), not as text. */
  readonly box: boolean;
  /** Its text, or the Typst it keeps (`src`), in one line. */
  readonly detail: string;
  /** Its marks (text). */
  readonly marks: readonly string[];
  /** Its attributes but `src`, those set (not null). */
  readonly attributes: string;
}

/** How positions map to the source, and which nodes are boxes: the Visual editor's (`VisualEditorContext`), for one document. */
export interface DocumentMapping<N> {
  posToSource(pos: number, bias?: 1 | -1): SourceOffset;
  isBox(node: N): boolean;
}

function row<N extends DocumentNode<N>>(node: N, pos: number, depth: number, mapping: DocumentMapping<N>): DocumentRow {
  const from = mapping.posToSource(pos);
  // a node with content ends where its content ends (after it, the separator to the next node follows)
  const inner = !node.isText && node.nodeSize > 1;
  const to = mapping.posToSource(pos + node.nodeSize - (inner ? 1 : 0), -1);
  const { src, ...attrs } = node.attrs;
  const set = Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== null && value !== undefined));
  const text = node.isText ? node.text : typeof src === 'string' ? src : undefined;
  return {
    depth,
    name: node.type.name,
    pos,
    end: pos + node.nodeSize,
    range: { from, to: to < from ? from : to },
    box: mapping.isBox(node),
    detail: text === undefined ? '' : describeValue(text),
    marks: node.marks.map((mark) => mark.type.name),
    attributes: Object.keys(set).length > 0 ? describeValue(set) : '',
  };
}
