// See DocumentNodeSpec in prosemirror-typst.ts.
import { flattenExtensions, getExtensionField, getSchema, type AnyExtension } from '@tiptap/core';
import type { Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import StarterKit, { type StarterKitOptions } from '@tiptap/starter-kit';
import { Disposable } from '../../core/disposable/disposable';
import { minimalChange, SourceOffset, SourceRange, type TextChange } from '../../core/typst-document/typst-document';
import { TypstConversions } from './typst-conversions';
import { parseDocument } from './parser';
import { escapeMarkup, forgetPrinted, printed, type Span } from './serializer';
import { unchangedNodes } from './unchanged-nodes';
import { RawBlock, RawInline, SoftBreak, sourceAnchors, TypstDocument, TypstSource } from './schema';
import type { DocumentNodeSpec, TypstMarkSpec } from './prosemirror-typst';

/** The schema of a document: the minimum schema plus the Tiptap extensions of the specs `nodes` and `marks`, their grammar attached. */
export function createSchema(nodes: readonly DocumentNodeSpec[], marks: readonly TypstMarkSpec[]): Schema {
  const schema = getSchema(documentExtensions(nodes, marks));
  attachGrammar(schema, nodes, marks);
  return schema;
}

/**
 * The Tiptap extensions of a schema holding `nodes` and `marks` besides the
 * minimum schema: the specs' extensions, between the base (paragraph, text,
 * history) and the raw Typst nodes. A spec's Tiptap extension defines its
 * node type's source anchors with its other attributes (never rendered; part
 * of node equality, so fresh parses compare exactly): `src`, the node's
 * original Typst; `sep`, the whitespace to its next sibling (`null` on last
 * children and on nodes made in the editor: a default separator is written).
 * A `labelled` spec's node type gets `label` (`{ name, gap }` or null): the
 * label after the block (`= Intro <intro>`), written after it. An editor made
 * of them (an equal but distinct schema) gets the grammar with `attachGrammar`.
 */
export function documentExtensions(nodes: readonly DocumentNodeSpec[], marks: readonly TypstMarkSpec[]): AnyExtension[] {
  const contributed = [...nodes, ...marks].map((spec) => spec.tiptap).filter((extension) => extension !== undefined);
  return [baseExtension(), ...new Set(contributed), TypstDocument, RawBlock, RawInline, SoftBreak, TypstSource, sourceAnchors([...BASE_NODES, ...nodes])];
}

/**
 * Some of Tiptap's StarterKit as one extension named `name`: the parts in
 * `parts` (with their options), no others. (The parts' own packages are not
 * dependencies of this package; StarterKit is.)
 */
export function starterKitPart(name: string, parts: Partial<StarterKitOptions>): AnyExtension {
  const options = Object.fromEntries(STARTER_KIT_PARTS.map((part) => [part, part in parts ? parts[part] : false]));
  return StarterKit.extend({ name }).configure(options);
}

/** The document `source` parses to, through the specs attached to `schema` (see `attachGrammar`). */
export function parseTypst(source: string, schema: Schema): Node {
  return parseDocument(source, schema, TypstConversions.of(schema));
}

/** The Typst source of `doc`: untouched nodes as they were written, edited ones printed anew. */
export function serializeToTypst(doc: Node): string {
  return printed(doc).text;
}

/**
 * Plain `text` as Typst markup that reads as exactly its characters, line by line: what starts markup escaped (`\*`,
 * `\#`, `\$`), and so is what starts a heading or list at a line's start (`\=`, `\-`).
 */
export function escapeTypst(text: string): string {
  return text.replace(/^([ \t]*)(.*)$/gm, (_, indent: string, line: string) => indent + escapeMarkup(line, true));
}

/**
 * Makes `nodes` and `marks` (after the minimum schema's own) the specs `parseTypst`
 * and `serializeToTypst` use for documents of `schema` (a schema made from
 * `documentExtensions` of them), in Tiptap's order: by the priority of the
 * Tiptap extension defining each one's type (`priority`, default 100, higher
 * first; equal ones as given). Their parse rules are asked in that order; of
 * specs of the same name, the later one wins.
 */
export function attachGrammar(schema: Schema, nodes: readonly DocumentNodeSpec[], marks: readonly TypstMarkSpec[]): void {
  const defining = flattenExtensions([...nodes, ...marks].flatMap((spec) => (spec.tiptap ? [spec.tiptap] : [])));
  const priorities = new Map(defining.map((extension) => [extension.name, getExtensionField<number>(extension, 'priority') || 100]));
  const inTiptapOrder = <T extends { name: string }>(specs: readonly T[]) =>
    [...specs].sort((a, b) => (priorities.get(b.name) ?? 100) - (priorities.get(a.name) ?? 100));
  TypstConversions.attach(schema, new TypstConversions([...BASE_NODES, ...inTiptapOrder(nodes)], inTiptapOrder(marks)));
}

/** The spec of `node`'s type in the grammar attached to its schema (specs of one name merged), if there is one. */
export function documentNodeSpec(node: Node): DocumentNodeSpec | undefined {
  return TypstConversions.of(node.type.schema).node(node.type);
}

/** Subscribes `listener` to every spec of `schema` whose parsing can change (see `TypstNodeConversion.onDidChange`). */
export function onDidChangeGrammar(schema: Schema, listener: () => void): Disposable {
  return Disposable.from(...TypstConversions.of(schema).changing().map((onDidChange) => onDidChange(listener)));
}

/**
 * The document position showing the source character at `offset`. Hidden
 * syntax (delimiters, markers, separators) maps to the next visible position
 * in its block; the inside of an atom to the position before the atom.
 *
 * With `bias` -1, `offset` is the end of a range and maps to the position
 * just after the visible character before it.
 */
export function sourceToPos(doc: Node, offset: SourceOffset, bias: 1 | -1 = 1): number {
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
export function posToSource(doc: Node, pos: number, bias: 1 | -1 = 1): SourceOffset {
  const { spans } = printed(doc);
  const end = bias < 0 ? endSource(spans, pos) : null;
  if (end !== null) return SourceOffset.of(end);
  const index = firstIndex(spans, (s) => s.pmTo > pos);
  const span = spans[index];
  if (span && span.kind !== 'syntax' && span.pmFrom <= pos) {
    return SourceOffset.of(span.kind === 'text' ? span.from + pos - span.pmFrom : span.from);
  }
  return SourceOffset.of(gapSource(spans, index, pos));
}

/**
 * Turns `tr.doc` into `target` (a fresh parse of the current text) with
 * the smallest replacement: ProseMirror's diff descends into equal-typed
 * nodes, so a changed word inside a paragraph replaces just that text and a
 * cursor elsewhere in the paragraph stays put. Attributes (`src`, `sep`) are
 * then updated in place and the result is marked unchanged since parsed again.
 */
export function applyTypstChanges(tr: Transaction, target: Node): Transaction {
  for (const attr of ['lead', 'trail']) {
    if (tr.doc.attrs[attr] !== target.attrs[attr]) tr.setDocAttribute(attr, target.attrs[attr]);
  }
  // Diff without the anchoring attributes: a block whose `src` changed must
  // still be descended into, not replaced wholesale. Sizes are unaffected.
  // `label` is not printed from `src` but compared like an anchor: a renamed label updates the attribute in place.
  const anchors = TypstConversions.of(target.type.schema).anchors;
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
  markUnchanged(tr.doc, target);
  forgetPrinted(tr.doc);
  return tr;
}

/**
 * The changes that turn `source`, the Typst `tr.before` shows, into the Typst of `tr.doc`: one per textblock the
 * transaction touched, so an edit in two places leaves the text between them alone (a concurrent edit there stays).
 *
 * The textblocks the steps touched are found in both documents; their source ranges cut the old and the new text into
 * matching pieces, and each pair of pieces gets its minimal change. Text a block's neighbours print (separators, list
 * markers, a doc's leading whitespace) lies between those ranges and is diffed the same way, so the changes always turn
 * `source` into exactly the new text; where cuts cannot be matched up they are dropped (at worst: one change for all).
 */
export function typstChanges(tr: Transaction, source: string = serializeToTypst(tr.before)): TextChange[] {
  const target = serializeToTypst(tr.doc);
  const cuts: Cut[] = [{ before: 0, after: 0 }];
  for (const { before, after } of touchedBlocks(tr)) {
    // `source` may differ from what `tr.before` prints (then the pieces differ, and their changes say how)
    cuts.push({ before: Math.min(posToSource(tr.before, before.from), source.length), after: posToSource(tr.doc, after.from) });
    cuts.push({ before: Math.min(posToSource(tr.before, before.to, -1), source.length), after: posToSource(tr.doc, after.to, -1) });
  }
  cuts.push({ before: source.length, after: target.length });
  const changes: TextChange[] = [];
  let last = cuts[0];
  for (const cut of cuts.slice(1)) {
    if (cut.before < last.before || cut.after < last.after) continue;
    const change = minimalChange(source.slice(last.before, cut.before), target.slice(last.after, cut.after));
    if (change) append(changes, { ...SourceRange.of({ from: last.before + change.from, to: last.before + change.to }), insert: change.insert });
    last = cut;
  }
  return changes;
}

/** The base: paragraphs, text, line breaks (`\`), history. */
function baseExtension(): AnyExtension {
  return starterKitPart('typstBase', { paragraph: {}, text: undefined, hardBreak: {}, undoRedo: {} });
}

/** The minimum schema's own nodes, as the grammar sees them. */
const BASE_NODES: readonly DocumentNodeSpec[] = [
  { name: 'paragraph', typst: { labelled: true } },
  { name: 'hardBreak' },
  { name: 'rawBlock', typst: { labelled: true } },
  { name: 'rawInline' },
];

/** Every part of StarterKit: each one not asked for is turned off. */
const STARTER_KIT_PARTS: readonly (keyof StarterKitOptions)[] = [
  'blockquote', 'bold', 'bulletList', 'code', 'codeBlock', 'document', 'dropcursor', 'gapcursor', 'hardBreak', 'heading', 'undoRedo',
  'horizontalRule', 'italic', 'listItem', 'listKeymap', 'link', 'orderedList', 'paragraph', 'strike', 'text', 'underline', 'trailingNode',
];

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

function markUnchanged(node: Node, target: Node): void {
  if (unchangedNodes.has(target)) unchangedNodes.set(node, unchangedNodes.get(target)!);
  if (node.childCount !== target.childCount) return;
  node.forEach((child, _offset, index) => markUnchanged(child, target.child(index)));
}

/** Offsets that cut the old (`before`) and the new text (`after`) at the same place. */
interface Cut {
  before: number;
  after: number;
}

/** A range of document positions. */
interface DocRange {
  from: number;
  to: number;
}

/** `change` added to `changes` (in order), merged with the last one if they touch. */
function append(changes: TextChange[], change: TextChange): void {
  const previous = changes.at(-1);
  if (previous?.to !== change.from) return void changes.push(change);
  changes[changes.length - 1] = { from: previous.from, to: change.to, insert: previous.insert + change.insert };
}

/**
 * What `tr` changed, in order: in `tr.doc` and as the range it replaced in `tr.before`, each widened to the content of
 * the textblocks its ends are in.
 */
function touchedBlocks(tr: Transaction): { before: DocRange; after: DocRange }[] {
  const back = tr.mapping.invert();
  return merged(changedRanges(tr)).map((after) => ({
    before: textblocks(tr.before, { from: back.map(after.from, -1), to: back.map(after.to, 1) }),
    after: textblocks(tr.doc, after),
  }));
}

/** The ranges of `tr.doc` its steps replaced or restyled. */
function changedRanges(tr: Transaction): DocRange[] {
  const ranges: DocRange[] = [];
  tr.steps.forEach((step, index) => {
    const later = tr.mapping.slice(index + 1);
    const add = (from: number, to: number) => ranges.push({ from: later.map(from, -1), to: later.map(to, 1) });
    let replaced = false;
    step.getMap().forEach((_from, _to, from, to) => {
      replaced = true;
      add(from, to);
    });
    if (replaced) return;
    // marks and attributes leave positions alone: their step's own range (a doc attribute has none)
    const { from, to, pos } = step as unknown as Partial<DocRange & { pos: number }>;
    if (from !== undefined && to !== undefined) add(from, to);
    else if (pos !== undefined) add(pos, pos + ((tr.docs[index + 1] ?? tr.doc).nodeAt(pos)?.nodeSize ?? 0));
  });
  return ranges;
}

/** `ranges` sorted, those that overlap or touch made one. */
function merged(ranges: DocRange[]): DocRange[] {
  const result: DocRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = result.at(-1);
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
  }
  return result;
}

/** `range` of `doc` grown to the content of the textblock each of its ends is in. */
function textblocks(doc: Node, { from, to }: DocRange): DocRange {
  const $from = doc.resolve(from);
  const $to = doc.resolve(Math.max(from, to));
  return { from: $from.parent.isTextblock ? $from.start() : from, to: $to.parent.isTextblock ? $to.end() : $to.pos };
}
