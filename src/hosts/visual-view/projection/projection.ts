/**
 * The source-anchored projection between Typst text and the Visual view's
 * ProseMirror document: the framework, which knows no Typst construct beyond
 * paragraphs, text and raw Typst. Every other construct comes in as a spec
 * (`NodeGrammar` / `MarkGrammar`, see grammar.ts): which syntax and calls it
 * projects, how an edited one prints. `attachGrammar` gives a schema its specs.
 *
 *   project(text, schema) → doc    every node remembers the source it came from
 *   print(doc)            → text   untouched nodes print their original source
 *                                  byte for byte; only edited ones are re-printed
 *   sourceToPos(doc, offset) / posToSource(doc, pos)
 *                                  map between source offsets and document
 *                                  positions, down to the character
 *   syncDoc(tr, target)   → tr     turns the current doc into a fresh projection
 *                                  with the smallest possible replacement
 *
 * Hence `print(project(text)) === text` for any input, and an edit in the
 * Visual view changes only the source of what it touched. Syntax no spec
 * models becomes `rawBlock` / `rawInline` atoms holding their verbatim source.
 * Labels (`<key>`) after a heading, or ending a block's run, are that block's
 * `label` attribute (see `labels.ts`).
 *
 * See ARCHITECTURE.md, "VisualView".
 */
import type { Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { Disposable } from '../../../core/disposable/disposable';
import { Grammar, type MarkGrammar, type NodeGrammar } from './grammar';
import { projectDocument } from './projecting';
import { forgetPrinted, printed, type Span } from './printing';
import { pristine } from './pristine';

/** The document `source` projects to, through the specs attached to `schema` (see `attachGrammar`). */
export function project(source: string, schema: Schema): Node {
  return projectDocument(source, schema, Grammar.of(schema));
}

/** The Typst source of `doc`: untouched nodes as they were written, edited ones printed anew. */
export function print(doc: Node): string {
  return printed(doc).text;
}

/**
 * Makes `nodes` and `marks` the specs `project` and `print` use for documents
 * of `schema` (a schema made from their extensions). Specs of the same name
 * merge, the later one winning.
 */
export function attachGrammar(schema: Schema, nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[]): void {
  Grammar.attach(schema, new Grammar(nodes, marks));
}

/** The spec of node `node`'s type in the grammar attached to its schema, if there is one. */
export function nodeGrammar(node: Node): NodeGrammar | undefined {
  return Grammar.of(node.type.schema).node(node.type);
}

/** Subscribes `listener` to every spec of `schema` whose projection can change (see `ProjectionSpec.onDidChange`). */
export function onDidChangeGrammar(schema: Schema, listener: () => void): Disposable[] {
  return Grammar.of(schema).changing().map((spec) => spec.onDidChange!(listener));
}

/**
 * The document position showing the source character at `offset`. Hidden
 * syntax (delimiters, markers, separators) maps to the next visible position
 * in its block; the inside of an atom to the position before the atom.
 *
 * With `bias` -1, `offset` is the end of a range and maps to the position
 * just after the visible character before it.
 */
export function sourceToPos(doc: Node, offset: number, bias: 1 | -1 = 1): number {
  const { spans, end } = printed(doc);
  if (bias < 0 && offset > 0) {
    const span = spans[firstIndex(spans, (s) => s.to >= offset)];
    if (span) return span.kind === 'text' ? span.pmFrom + offset - span.from : span.pmTo;
  }
  const span = spans[firstIndex(spans, (s) => s.to > offset)];
  if (!span) return end;
  return span.kind === 'text' ? span.pmFrom + Math.max(0, offset - span.from) : span.pmFrom;
}

/**
 * The source offset of the character after document position `pos`; at the
 * end of a block or between blocks, the offset just after the preceding
 * visible source.
 *
 * With `bias` -1, `pos` is the end of a range and maps to just after the
 * source of the visible character (or atom) before it.
 */
export function posToSource(doc: Node, pos: number, bias: 1 | -1 = 1): number {
  const { spans } = printed(doc);
  const end = bias < 0 ? endSource(spans, pos) : null;
  if (end !== null) return end;
  const index = firstIndex(spans, (s) => s.pmTo > pos);
  const span = spans[index];
  if (span && span.kind !== 'syntax' && span.pmFrom <= pos) {
    return span.kind === 'text' ? span.from + pos - span.pmFrom : span.from;
  }
  return gapSource(spans, index, pos);
}

/**
 * Turns `tr.doc` into `target` (a fresh projection of the current text) with
 * the smallest replacement: ProseMirror's diff descends into equal-typed
 * nodes, so a changed word inside a paragraph replaces just that text and a
 * cursor elsewhere in the paragraph stays put. Attributes (`src`, `sep`) are
 * then updated in place and the result is marked pristine again.
 */
export function syncDoc(tr: Transaction, target: Node): Transaction {
  for (const attr of ['lead', 'trail']) {
    if (tr.doc.attrs[attr] !== target.attrs[attr]) tr.setDocAttribute(attr, target.attrs[attr]);
  }
  // Diff without the anchoring attributes: a block whose `src` changed must
  // still be descended into, not replaced wholesale. Sizes are unaffected.
  // `label` is not printed from `src` but compared like an anchor: a renamed label updates the attribute in place.
  const anchors = Grammar.of(target.type.schema).anchors;
  const current = withoutAnchors(tr.doc, anchors).content;
  const wanted = withoutAnchors(target, anchors).content;
  const start = current.findDiffStart(wanted);
  if (start !== null) {
    let { a: endA, b: endB } = current.findDiffEnd(wanted)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    tr.replace(start, endA, target.slice(start, endB));
  }
  copyAttrs(tr, target);
  markPristine(tr.doc, target);
  forgetPrinted(tr.doc);
  return tr;
}

/** The source end of the visible character or atom ending at `pos`, if there is one. */
function endSource(spans: Span[], pos: number): number | null {
  const span = spans[firstIndex(spans, (s) => s.pmTo >= pos)];
  if (!span || span.kind === 'syntax' || span.pmFrom >= pos) return null;
  return span.kind === 'text' ? span.from + pos - span.pmFrom : span.to;
}

/** For `pos` between visible spans, before `spans[index]`: the end of the visible source ending right there, or of the syntax up to it. */
function gapSource(spans: Span[], index: number, pos: number): number {
  let before = index - 1;
  while (before >= 0 && spans[before].kind === 'syntax' && spans[before].pmTo === pos) before--;
  if (before >= 0 && spans[before].pmTo === pos) return spans[before].to;
  return index > 0 ? spans[index - 1].to : 0;
}

/** The first index whose span satisfies `test`, which is monotonic over the spans; `spans.length` if none. */
function firstIndex(spans: Span[], test: (span: Span) => boolean): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (test(spans[mid])) high = mid;
    else low = mid + 1;
  }
  return low;
}

function withoutAnchors(node: Node, anchors: ReadonlySet<string>): Node {
  if (node.isText) return node;
  const attrs = { ...node.attrs };
  for (const key of anchors) if (key in attrs) attrs[key] = null;
  const content: Node[] = [];
  node.forEach((child) => content.push(withoutAnchors(child, anchors)));
  return node.type.create(attrs, content, node.marks);
}

/** Updates node attributes that differ from `target` (structure is already equal). */
function copyAttrs(tr: Transaction, target: Node): void {
  tr.doc.descendants((node, pos) => {
    const other = target.nodeAt(pos);
    if (other && other.type === node.type && !node.hasMarkup(other.type, other.attrs, node.marks)) {
      tr.setNodeMarkup(pos, undefined, other.attrs);
    }
  });
}

function markPristine(node: Node, target: Node): void {
  if (pristine.has(target)) pristine.set(node, pristine.get(target)!);
  if (node.childCount !== target.childCount) return;
  node.forEach((child, _offset, index) => markPristine(child, target.child(index)));
}
