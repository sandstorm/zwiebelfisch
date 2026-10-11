import type { SyntaxNode } from '@lezer/common';
import { flattenExtensions, getExtensionField, getSchema, type AnyExtension } from '@tiptap/core';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import StarterKit, { type StarterKitOptions } from '@tiptap/starter-kit';
import { Disposable } from '../../core/disposable/disposable';
import { SourceOffset, type SourceRange } from '../../core/typst-document/typst-document';
import type { Event } from '../../core/event-emitter/event-emitter';
import { TypstConversions } from './typst-conversions';
import { parseDocument } from './parser';
import { forgetPrinted, printed, type Span } from './serializer';
import { unchangedNodes } from './unchanged-nodes';
import { RawBlock, RawInline, SoftBreak, sourceAnchors, TypstDocument, TypstSource } from './schema';

/**
 * The schema of `nodes` and `marks`: the minimum schema plus the specs' Tiptap extensions, with their grammar
 * attached. Tests use it; the Visual editor uses `documentExtensions` and `attachGrammar`.
 *
 * This module converts between Typst text and the Visual editor's ProseMirror document, so that an edit changes only
 * the source of what it touched. Every node remembers the source it came from. `parseTypst` reads text into a
 * document; `serializeToTypst` writes it back, where untouched nodes print their source byte for byte and only edited
 * ones are printed anew. So `serializeToTypst(parseTypst(text)) === text` for any text. `sourceToPos` and
 * `posToSource` map between source offsets and document positions, down to the character. `applyTypstChanges` turns
 * the shown document into a fresh parse with the smallest replacement.
 *
 * The framework knows only paragraphs, text, breaks and raw Typst (the minimum schema). Every other construct is a
 * spec (`DocumentNodeSpec`, `TypstMarkSpec`) that an extension contributes to the Visual editor: which syntax it
 * reads, how an edited node is written. Syntax no spec takes stays raw Typst (`rawBlock`, `rawInline`), kept verbatim.
 * Plain ProseMirror: no view, tested without a DOM. See docs/30_architecture/03_prosemirror-typst.typ.
 */
export function createSchema(nodes: readonly DocumentNodeSpec[], marks: readonly TypstMarkSpec[]): Schema {
  const schema = getSchema(documentExtensions(nodes, marks));
  attachGrammar(schema, nodes, marks);
  return schema;
}

/** A block's label: its name, and the source between the block and `<name>` (`' '`, `''`, `'\n'`). */
export interface BlockLabel {
  name: string;
  gap: string;
}

/** An inline node and the source range it shows; source between placed nodes is hidden syntax. */
export interface PlacedNode {
  node: Node;
  from: number;
  to: number;
}

/**
 * What parse functions get to build nodes from Typst syntax: the source, the schema, and the framework's own
 * steps (blocks of a content block, inline content, textblocks that write their source while untouched).
 */
export interface TypstParseContext {
  readonly schema: Schema;
  readonly source: string;
  /** The source of `range` (or of a syntax node). */
  text(range: SourceRange | SyntaxNode): string;
  /** A call (a `FuncCall` without `#`, e.g. a figure's body) as the block the specs' parse rules make of it, or null. */
  blockCall(call: SyntaxNode): Node | null;
  /** The blocks of a closed content block `[..]` (an empty paragraph if there are none), and the source they cover. */
  blocks(content: SyntaxNode): { content: Node[]; from: SourceOffset; to: SourceOffset };
  /**
   * The blocks of an item's body (a list item's `Markup`: its first line, then lines indented deeper than its
   * marker), parsed from `src`, the body with the `indent` common to its further lines removed (null: one line).
   * An empty body is an empty paragraph; one whose source the blocks would not print back is a raw block.
   */
  itemBlocks(body: SyntaxNode): { content: Node[]; src: string; indent: string | null };
  /** Parses inline syntax (a textblock's content), each node carrying `marks`. */
  inline(nodes: readonly SyntaxNode[], marks?: readonly Mark[]): PlacedNode[];
  /** Whether markup `nodes` are one paragraph: no paragraph break, no block of its own (heading, list item). */
  isOneParagraph(nodes: readonly SyntaxNode[]): boolean;
  /**
   * A textblock whose `attrs.src` starts at source offset `from`; while untouched it prints `src` verbatim. Its
   * content ends at `contentTo` (default: the end of `src`); syntax after that closes the block (a code fence).
   */
  textblock(block: { type: string; attrs: { src: string } & Record<string, unknown>; contentTo?: number }, from: number, content: PlacedNode[]): Node;
  /** A node that prints `attrs.src` while untouched (a task item: its marker, then its only child). */
  unchangedNode(type: string, attrs: Record<string, unknown>, content?: Node[]): Node;
  /** Verbatim inline Typst: a raw inline box. */
  raw(src: string, marks?: readonly Mark[]): Node;
  /** Counts up from 0 within the textblock being parsed (equal neighbouring marks stay apart by such an `id`). */
  serial(): number;
}

/**
 * Which Typst a spec reads (ProseMirror's `parseDOM`, for Typst): syntax nodes by their name in the Lezer grammar of
 * codemirror-lang-typst, calls by the function's name. Each function gets the `TypstParseContext` and the Lezer node
 * (for a call: its `FuncCall`, read with the typst-syntax functions), and returns what the source becomes, or null
 * to let the next spec try (none: the source stays raw Typst). Of specs reading the same syntax or call, the one
 * whose Tiptap extension has the higher priority is asked first.
 */
export interface TypstParseRules {
  /** By syntax node name (`Heading`, `ListItem`, `Raw`, `Strong`, `Ref`). */
  readonly syntaxNodes?: Readonly<Record<string, {
    /**
     * The block a run of markup (up to a paragraph break) that is exactly this node becomes (`Raw` over several
     * lines: a code block); with `standsAlone`, the block the node always is.
     */
    block?(p: TypstParseContext, node: SyntaxNode, sep: string | null): Node | null;
    /** A block of its own even without paragraph breaks around it (`Heading`, `ListItem`): the markup around it are other blocks. */
    readonly standsAlone?: boolean;
    /** A label right after it (same line or the next, then a paragraph break or a block) is its label: headings. */
    readonly takesLabel?: boolean;
    /** The node in running text: a node showing all of its source, or placed content (its text with marks). Such syntax makes its run a paragraph. */
    inline?(p: TypstParseContext, node: SyntaxNode, marks: readonly Mark[]): Node | PlacedNode[] | null;
  }>>;
  /** By the called function's name (`calleeName`); `*` takes the calls no spec names. */
  readonly calls?: Readonly<Record<string, {
    /**
     * The block a run that is exactly one `#name(..)` call becomes (its source: `withHash(call)`), or a call read as a
     * block elsewhere (a figure's body, without `#`). Check the arguments first.
     */
    block?(p: TypstParseContext, call: SyntaxNode, sep: string | null): Node | null;
    /** The call after `#` in running text (`#link("url")[text]`): a node, or placed content. */
    inline?(p: TypstParseContext, call: SyntaxNode, marks: readonly Mark[]): Node | PlacedNode[] | null;
    /** Whether `call` belongs in running text (makes its run a paragraph), even where `inline` leaves it raw. Default with `inline`: yes. */
    inRunningText?(p: TypstParseContext, call: SyntaxNode): boolean;
  }>>;
}

/**
 * The Typst of a node type: how it is read (`parseTypst`) and written back when edited (`toTypst`, ProseMirror's
 * `toDOM` for Typst), and how its source is kept.
 */
export interface TypstNodeConversion {
  readonly parseTypst?: TypstParseRules;
  /**
   * Writes an edited (not untouched) block that starts at document position `pos` inside `parent`. Default for
   * textblocks: their inline content; block atoms write their `src`.
   */
  toTypst?(state: TypstSerializeState, node: Node, pos: number, parent: Node): void;
  /** The source of an inline atom (`@intro`). */
  atomToTypst?(node: Node): string;
  /** Text written right after this inline atom, escaped where it would continue the atom's syntax (`@intro\s`). */
  escapeAfter?(node: Node, text: string): string;
  /** A label may follow it (`<intro>`): it gets the `label` attribute, written after it. */
  readonly labelled?: boolean;
  /**
   * Those of its attributes (defined by its Tiptap extension, never rendered) that keep how its source was written
   * and that a fresh parse may change in place (`marker`, `layout`), as `src` and `sep` are.
   */
  readonly anchors?: readonly string[];
  /** Consecutive nodes of this type form a container, of the type this returns (list items: their list). */
  container?(item: Node): string;
  /** Fires when what it reads changed (styles declared or removed): editors parse their document again. */
  readonly onDidChange?: Event<void>;
}

/**
 * A node type of the Visual editor's document: its Tiptap extension (`Node.create(..)`: schema, attributes, node view,
 * commands, keymap, priority; omitted if another spec's extension defines it too) and its Typst. A second spec of
 * the same name extends the first (another `toTypst`, more parse rules).
 */
export interface DocumentNodeSpec {
  readonly name: string;
  readonly tiptap?: AnyExtension;
  readonly typst?: TypstNodeConversion;
}

/** What a formatted span starts and ends with, and the written characters around it. */
export interface Around {
  before: string | undefined;
  after: string | undefined;
  first: string;
  last: string;
  /** The span's text, as the document shows it. */
  text: string;
}

/** The Typst of a mark type: how it is read, and the syntax around an edited span. */
export interface TypstMarkConversion {
  readonly parseTypst?: TypstParseRules;
  /** The syntax around a formatted span: `*…*`, or `#strong[…]` where delimiters would not work. */
  toTypst(mark: Mark, around: Around): { open: string; close: string };
  /** Raw text: its text is written as is (no escapes), innermost, closed and reopened around other formatting (inline code). */
  readonly raw?: boolean;
  /** Whether `text` needs nothing around it, Typst reading it back as this mark all the same (a bare URL). */
  isBare?(mark: Mark, text: string, around: Around): boolean;
  /** Fires when what it reads changed (styles declared or removed): editors parse their document again. */
  readonly onDidChange?: Event<void>;
}

/** A mark type of the Visual editor's document (bold, a link, a margin note's range): its Tiptap extension and its Typst. */
export interface TypstMarkSpec {
  readonly name: string;
  /** `Mark.create(..)`; omitted if another spec's extension defines it too. */
  readonly tiptap?: AnyExtension;
  readonly typst: TypstMarkConversion;
}

/**
 * Accumulates source text together with the document positions each part of it belongs to. The `toTypst` of edited
 * blocks writes through it: syntax hidden in the document, shown text and atoms, and child blocks, which are written
 * as their specs say.
 */
export interface TypstSerializeState {
  /** Source not shown in the document; it maps to the next visible position in its block. */
  hidden(src: string): void;
  /** Source shown by the document range `pmFrom`..`pmTo`. */
  shown(src: string, kind: 'text' | 'atom', pmFrom: number, pmTo: number): void;
  /**
   * Closes a textblock whose content ends at `pos`: its trailing syntax maps there. An `empty` block shows no source,
   * so a zero-width span marks where its content would go.
   */
  endBlock(pos: number, empty: boolean): void;
  /** Source closing the block printed last (e.g. a table cell's `]`); it maps to that block's end. */
  closing(src: string): void;
  /** Source right after the syntax printed last, mapping where that syntax maps (e.g. a block's label). */
  after(src: string): void;
  /** Prints with every line of the output but empty ones indented by `by` (default: two spaces) more. */
  indented(print: () => void, by?: string): void;
  /** Prints the children of `container`, whose content starts at document position `start`, `defaultSep` between new ones. */
  blocks(container: Node, start: number, defaultSep: string): void;
  /** Prints `node`, which starts at document position `pos`, and its label; the label maps to the block's end. */
  block(node: Node, parent: Node, pos: number): void;
  /** A textblock's inline content and end: the default `toTypst` of edited textblocks. */
  textblock(block: Node, pos: number): void;
  /** The inline content of `block`, which starts at document position `start`. */
  inline(block: Node, start: number): void;
  /**
   * An item at `pos` (a list item): `prefix` (its marker), its first child, further children on following lines;
   * lines after the first are indented by `indent` (default: two spaces).
   */
  item(item: Node, pos: number, prefix: string, indent?: string): void;
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

/** The base: paragraphs, text, line breaks (`\`), history, drop and gap cursors. */
function baseExtension(): AnyExtension {
  return starterKitPart('typstBase', { paragraph: {}, text: undefined, hardBreak: {}, undoRedo: {}, dropcursor: {}, gapcursor: undefined });
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
