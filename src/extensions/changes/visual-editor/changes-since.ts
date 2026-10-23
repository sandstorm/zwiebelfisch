// What changed in a Visual editor's document since an original Typst text. See changes in ../changes.ts.
import type { Fragment, Mark, Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { ChangeSet, simplifyChanges, type TokenEncoder } from 'prosemirror-changeset';
import { applyTypstChanges, parseTypst } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';

/** What a document has that its original has not (`inserted`), and what it lost (`deleted`), word by word. */
export interface DocumentChanges {
  /** Ranges of the document (its positions) that are new. */
  readonly inserted: readonly { readonly from: number; readonly to: number }[];
  readonly deleted: readonly Deletion[];
}

/** Content of the original that is gone, shown at `pos` of the document. */
export interface Deletion {
  readonly pos: number;
  /** Its text: one line per block it touched (a box: its Typst). */
  readonly lines: readonly string[];
  /** Whether `pos` is inside a text block (show it as text there), else between blocks (show it as a block). */
  readonly inline: boolean;
}

/**
 * The changes from `original` (Typst, read with `doc`'s schema and grammar) to `doc`. A box whose Typst changed is
 * inserted only (its old Typst is not listed as deleted); a format applied or removed counts as text replaced.
 *
 * Used by: the Visual editor's change decorations (change-decorations.ts).
 */
export function changesSince(original: string, doc: Node): DocumentChanges {
  const old = parseTypst(original, doc.type.schema);
  const tr = applyTypstChanges(EditorState.create({ doc: old }).tr, doc);
  const changes = simplifyChanges(ChangeSet.create(old, undefined, ENCODER).addSteps(tr.doc, tr.mapping.maps, null).changes, tr.doc);
  return {
    inserted: changes.filter((change) => change.toB > change.fromB).map((change) => ({ from: change.fromB, to: change.toB })),
    deleted: changes.flatMap((change) => {
      const content = old.slice(change.fromA, change.toA).content;
      const lines = linesOf(content);
      const boxesOnly = !hasText(content);
      if (lines.every((line) => line === '') || (boxesOnly && change.toB > change.fromB)) return [];
      return [{ pos: change.fromB, lines, inline: tr.doc.resolve(change.fromB).parent.inlineContent }];
    }),
  };
}

/**
 * Text compared with its marks, nodes with their attributes (not where they sit: `sep`, `label`; a block's `src`
 * is its content's Typst, compared as that content).
 */
const ENCODER: TokenEncoder<string> = {
  encodeCharacter: (char: number, marks: readonly Mark[]) => String.fromCharCode(char) + marks.map((mark) => `:${mark.type.name}`).join(''),
  encodeNodeStart: (node: Node) => node.type.name + JSON.stringify({ ...node.attrs, sep: null, label: null, ...(node.isLeaf ? {} : { src: null }) }),
  encodeNodeEnd: (node: Node) => `/${node.type.name}`,
  compareTokens: (a: string, b: string) => a === b,
};

/** The text of each text block and box in `content`, in order (inline content: one line). */
function linesOf(content: Fragment): string[] {
  if (content.firstChild?.isInline) return [inlineText(content)];
  const lines: string[] = [];
  content.forEach((node) => {
    if (node.inlineContent) lines.push(inlineText(node.content));
    else if (node.isLeaf) lines.push(boxText(node));
    else lines.push(...linesOf(node.content));
  });
  return lines;
}

function inlineText(content: Fragment): string {
  let text = '';
  content.forEach((node) => (text += node.isText ? node.text! : boxText(node)));
  return text;
}

/** A box's Typst, as written (`src`); '' for other leaves (a line break). */
function boxText(node: Node): string {
  return typeof node.attrs.src === 'string' ? node.attrs.src : '';
}

function hasText(content: Fragment): boolean {
  let found = false;
  content.descendants((node) => {
    found ||= node.isText;
    return !found;
  });
  return found;
}
