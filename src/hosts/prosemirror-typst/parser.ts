// Parsing Typst text into the Visual editor's document (TypstToProseMirrorParser). See prosemirror-typst.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { PlacedNode, TypstParseContext, BlockLabel } from './prosemirror-typst';
import type { TypstConversions } from './typst-conversions';
import { labelAfterBlock, splitTrailingLabel } from './labels';
import { layout, unchangedNodes } from './unchanged-nodes';
import { calleeName, children } from '../../core/typst-syntax/typst-syntax';
import { type SourceOffset, SourceRange } from '../../core/typst-document/typst-document';

/**
 * Parses `source` into a document of `schema`, through the grammar attached to it.
 *
 * Markup is segmented into blocks, and every block and piece of inline syntax goes to the specs' parse rules for it;
 * what none models stays raw.
 */
export function parseDocument(source: string, schema: Schema, grammar: TypstConversions): Node {
  return new TypstToProseMirrorParser(schema, source, grammar).document();
}

/** Parses one source text into a document: what the specs' parse functions get as their `TypstParseContext`. */
class TypstToProseMirrorParser implements TypstParseContext {
  /** See `serial`. */
  private serials = 0;

  constructor(
    readonly schema: Schema,
    readonly source: string,
    private readonly grammar: TypstConversions,
  ) {}

  document(): Node {
    const { schema, source } = this;
    const segments = this.segment(children(typstParser.parse(source).topNode));
    if (segments.length === 0) {
      return schema.nodes.doc.create({ lead: source, trail: '' }, [this.textblock({ type: 'paragraph', attrs: { src: '' } }, 0, [])]);
    }
    return schema.nodes.doc.create({ lead: source.slice(0, segments[0].from), trail: source.slice(end(segments.at(-1)!)) }, this.blocksOf(segments));
  }

  text({ from, to }: SourceRange | SyntaxNode): string {
    return this.source.slice(from, to);
  }

  blockCall(call: SyntaxNode): Node | null {
    return call.name === 'FuncCall' ? this.callBlock(call, null) : null;
  }

  blocks(content: SyntaxNode): { content: Node[]; from: SourceOffset; to: SourceOffset } {
    const markup = content.getChild('Markup')!;
    const segments = this.segment(children(markup));
    const from = segments[0]?.from ?? markup.from;
    const to = segments.length > 0 ? end(segments.at(-1)!) : markup.from;
    const blocks = segments.length > 0 ? this.blocksOf(segments) : [this.textblock({ type: 'paragraph', attrs: { src: '' } }, from, [])];
    return { content: blocks, ...SourceRange.of({ from, to }) };
  }

  itemBlocks(body: SyntaxNode): { content: Node[]; src: string; indent: string | null } {
    const [first, ...further] = this.text(body).split('\n');
    const indent = further.length > 0 ? commonIndent(further.filter((line) => line !== '')) : null;
    const src = [first, ...further.map((line) => line.slice(indent!.length))].join('\n');
    // a parser of its own: the body's blocks print `src`, which the serializer indents again
    const parser = new TypstToProseMirrorParser(this.schema, src, this.grammar);
    if (src === '') return { content: [parser.textblock({ type: 'paragraph', attrs: { src } }, 0, [])], src, indent };
    const segments = parser.segment(children(typstParser.parse(src).topNode));
    const covers = segments.length > 0 && segments[0].from === 0 && end(segments.at(-1)!) === src.length;
    return { content: covers ? parser.blocksOf(segments) : [this.schema.nodes.rawBlock.create({ src })], src, indent };
  }

  inline(nodes: readonly SyntaxNode[], marks: readonly Mark[] = []): PlacedNode[] {
    const result: PlacedNode[] = [];
    let pos = nodes[0]?.from ?? 0;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].from > pos) result.push({ node: this.raw(this.source.slice(pos, nodes[i].from), marks), from: pos, to: nodes[i].from });
      const piece = this.parseAt(nodes, i, marks);
      result.push(...piece.placed);
      pos = piece.to;
      i = piece.last;
    }
    return result;
  }

  isOneParagraph(nodes: readonly SyntaxNode[]): boolean {
    return nodes.every((n) => n.name !== 'Parbreak' && !this.isStandalone(n));
  }

  textblock({ type, attrs, contentTo }: { type: string; attrs: { src: string } & Record<string, unknown>; contentTo?: number }, from: number, content: PlacedNode[]): Node {
    const node = this.schema.nodes[type].create(attrs, content.map((p) => p.node));
    const to = from + attrs.src.length;
    unchangedNodes.set(node, layout(content, from, contentTo ?? to, to));
    this.serials = 0; // the next textblock counts from 0 again
    return node;
  }

  unchangedNode(type: string, attrs: Record<string, unknown>, content?: Node[] | Node['content']): Node {
    const node = this.schema.nodes[type].create(attrs, content);
    unchangedNodes.set(node, null);
    return node;
  }

  raw(src: string, marks: readonly Mark[] = []): Node {
    return this.schema.nodes.rawInline.create({ src }, null, marks);
  }

  serial(): number {
    return this.serials++;
  }

  /** Text decoded from an escape or shorthand, remembering how it was written. */
  sourceText(src: string, text: string, marks: readonly Mark[]): Node {
    return this.schema.text(text, this.schema.marks.typstSource.create({ src, text }).addToSet(marks));
  }

  // ------------------------------------------------------------- blocks

  private isStandalone(node: SyntaxNode): boolean {
    return this.grammar.syntaxNode(node.name).some((rule) => rule.standsAlone);
  }

  /**
   * Splits markup into blocks: block syntax (headings, list items) stands
   * alone, the rest forms runs up to a paragraph break. A label right after a
   * heading, or at the end of a run, goes with that segment.
   */
  private segment(nodes: SyntaxNode[]): Segment[] {
    const segments: Segment[] = [];
    let run: SyntaxNode[] = [];
    const flushRun = () => {
      while (run.length > 0 && run.at(-1)!.name === 'Space') run.pop();
      if (run.length > 0) {
        const { content, label } = splitTrailingLabel(run);
        segments.push({ kind: 'run', nodes: content, from: content[0].from, to: content.at(-1)!.to, label });
      }
      run = [];
    };
    nodes.forEach((node, index) => {
      if (this.isStandalone(node)) {
        flushRun();
        segments.push({ kind: 'block', nodes: [node], from: node.from, to: node.to, label: null });
      } else if (node.name === 'Parbreak') {
        flushRun();
      } else if (run.length === 0 && this.labelsLastBlock(segments.at(-1), nodes, index)) {
        segments.at(-1)!.label = node;
      } else if (node.name !== 'Space' || run.length > 0) {
        run.push(node);
      }
    });
    flushRun();
    return segments;
  }

  /** Whether `nodes[index]` is the label of `last`, a block that takes the label after it (a heading). */
  private labelsLastBlock(last: Segment | undefined, nodes: SyntaxNode[], index: number): boolean {
    if (last?.kind !== 'block' || last.label) return false;
    const takesLabel = this.grammar.syntaxNode(last.nodes[0].name).some((rule) => rule.takesLabel);
    return takesLabel && labelAfterBlock(nodes, index, last.nodes[0], (node) => this.isStandalone(node));
  }

  /** Parses the blocks of a markup range (`doc` content, a content block's); list items form lists. */
  private blocksOf(segments: Segment[]): Node[] {
    const sepAfter = (index: number) => (segments[index + 1] ? this.source.slice(end(segments[index]), segments[index + 1].from) : null);
    return this.groupContainers(segments.map((segment, i) => this.toBlock(segment, sepAfter(i))));
  }

  /** The block a segment becomes, with the segment's label (if any) as its `label` attribute. */
  private toBlock(segment: Segment, sep: string | null): Node {
    const block = segment.kind === 'block' ? this.standalone(segment.nodes[0], sep) : this.runBlock(segment, sep);
    if (!segment.label) return block;
    const label: BlockLabel = { name: this.source.slice(segment.label.from + 1, segment.label.to - 1), gap: this.source.slice(segment.to, segment.label.from) };
    const labelled = block.type.create({ ...block.attrs, label }, block.content, block.marks);
    if (unchangedNodes.has(block)) unchangedNodes.set(labelled, unchangedNodes.get(block)!);
    return labelled;
  }

  /** Block syntax standing alone: the first rule's block, else a raw block. */
  private standalone(node: SyntaxNode, sep: string | null): Node {
    for (const rule of this.grammar.syntaxNode(node.name)) {
      const block = rule.standsAlone ? rule.block?.(this, node, sep) : null;
      if (block) return block;
    }
    return this.schema.nodes.rawBlock.create({ src: this.text(node), sep });
  }

  /** A run of inline syntax: a block of its own syntax (a code block), a paragraph, a block call or else a raw block. */
  private runBlock(segment: Segment, sep: string | null): Node {
    const src = this.source.slice(segment.from, segment.to);
    const [only] = segment.nodes;
    if (segment.nodes.length === 1) {
      for (const rule of this.grammar.syntaxNode(only.name)) {
        const block = rule.standsAlone ? null : rule.block?.(this, only, sep);
        if (block) return block;
      }
    }
    if (segment.nodes.some((n) => this.isProse(n))) {
      return this.textblock({ type: 'paragraph', attrs: { src, sep } }, segment.from, this.inline(segment.nodes));
    }
    return this.runCall(segment, sep) ?? this.schema.nodes.rawBlock.create({ src, sep });
  }

  /** Syntax that makes a run a paragraph: text, inline syntax a spec models, calls that belong in running text. */
  private isProse(node: SyntaxNode): boolean {
    if (TEXT.has(node.name) || this.grammar.syntaxNode(node.name).some((rule) => rule.inline)) return true;
    const rules = node.name === 'FuncCall' ? this.grammar.call(calleeName(node, this.source), 'inline') : [];
    return rules.some((rule) => rule.inRunningText?.(this, node) ?? true);
  }

  /** A run that is exactly one `#func(..)` call: the block the calls' rules make of it. */
  private runCall(segment: Segment, sep: string | null): Node | null {
    const [hash, call, ...rest] = segment.nodes;
    if (hash.name !== 'Hash' || call?.name !== 'FuncCall' || call.from !== hash.to || rest.length > 0) return null;
    return this.callBlock(call, sep);
  }

  private callBlock(call: SyntaxNode, sep: string | null): Node | null {
    for (const rule of this.grammar.call(calleeName(call, this.source), 'block')) {
      const block = rule.block!(this, call, sep);
      if (block) return block;
    }
    return null;
  }

  /** Wraps consecutive items of the same container (list items: their list); the last item's separator moves to it. */
  private groupContainers(blocks: Node[]): Node[] {
    const result: Node[] = [];
    let items: Node[] = [];
    const containerOf = (block: Node) => this.grammar.node(block.type)?.typst?.container?.(block) ?? null;
    const flush = () => {
      if (items.length === 0) return;
      const last = items.at(-1)!;
      items[items.length - 1] = last.type.create({ ...last.attrs, sep: null }, last.content);
      if (unchangedNodes.has(last)) unchangedNodes.set(items.at(-1)!, unchangedNodes.get(last)!);
      result.push(this.schema.nodes[containerOf(items[0])!].create({ sep: last.attrs.sep }, items));
      items = [];
    };
    for (const block of blocks) {
      const container = containerOf(block);
      if (container === null || (items.length > 0 && containerOf(items[0]) !== container)) flush();
      if (container === null) result.push(block);
      else items.push(block);
    }
    flush();
    return result;
  }

  // ------------------------------------------------------------- inline

  /** Parses `nodes[index]`, or a `#` together with the expression after it as one piece of code. */
  private parseAt(nodes: readonly SyntaxNode[], index: number, marks: readonly Mark[]): { placed: PlacedNode[]; to: number; last: number } {
    const node = nodes[index];
    const code = node.name === 'Hash' && nodes[index + 1]?.from === node.to ? nodes[index + 1] : null;
    const to = code ? code.to : node.to;
    const src = this.source.slice(node.from, to);
    const parsed = (code ? this.codeNode(code, marks) : this.inlineNode(node, src, marks)) ?? this.raw(src, marks);
    return { placed: Array.isArray(parsed) ? parsed : [{ node: parsed, from: node.from, to }], to, last: code ? index + 1 : index };
  }

  /** One piece of inline syntax: the framework's text, else what a spec makes of it (null: raw). */
  private inlineNode(node: SyntaxNode, src: string, marks: readonly Mark[]): Node | PlacedNode[] | null {
    const own = INLINE[node.name];
    if (own) return own(this, src, marks);
    for (const rule of this.grammar.syntaxNode(node.name)) {
      const parsed = rule.inline?.(this, node, marks);
      if (parsed) return parsed;
    }
    return null;
  }

  /** The expression after a `#`: a call some spec models in running text (a link, a margin note), else raw. */
  private codeNode(node: SyntaxNode, marks: readonly Mark[]): Node | PlacedNode[] | null {
    if (node.name !== 'FuncCall') return null;
    for (const rule of this.grammar.call(calleeName(node, this.source), 'inline')) {
      const parsed = rule.inline!(this, node, marks);
      if (parsed) return parsed;
    }
    return null;
  }
}

/** Where a segment's source ends, its label included. */
function end(segment: Segment): number {
  return segment.label?.to ?? segment.to;
}

/** A top-level stretch of source that becomes one block (or one list item), and the label after it. */
interface Segment {
  /** Block syntax standing alone (a heading, a list item), or a run of inline syntax up to a paragraph break. */
  kind: 'block' | 'run';
  nodes: SyntaxNode[];
  from: number;
  /** The end of the block's own source, before its label. */
  to: number;
  label: SyntaxNode | null;
}

/** The leading whitespace all of `lines` share. */
function commonIndent(lines: readonly string[]): string {
  return lines.reduce((indent, line) => {
    let n = 0;
    while (n < indent.length && line[n] === indent[n]) n++;
    return indent.slice(0, n);
  }, /^[ \t]*/.exec(lines[0] ?? '')![0]);
}

/** Syntax the framework itself shows as text; any inline syntax a spec models counts as prose too. */
const TEXT = new Set(['Text', 'Escape', 'Shorthand', 'SmartQuote']);

/** The framework's own inline syntax: text, newlines, escapes and shorthands. */
const INLINE: Record<string, (p: TypstToProseMirrorParser, src: string, marks: readonly Mark[]) => Node> = {
  Text: (p, src, marks) => p.schema.text(src, marks),
  SmartQuote: (p, src, marks) => p.schema.text(src, marks),
  Space: (p, src, marks) => (src.includes('\n') ? p.schema.nodes.softBreak.create({ src }) : p.schema.text(src, marks)),
  Escape: (p, src, marks) => p.sourceText(src, decodeEscape(src), marks),
  Shorthand: (p, src, marks) => (src in SHORTHANDS ? p.sourceText(src, SHORTHANDS[src], marks) : p.raw(src, marks)),
};

function decodeEscape(src: string): string {
  const unicode = /^\\u\{([0-9a-fA-F]+)\}$/.exec(src);
  return unicode ? String.fromCodePoint(parseInt(unicode[1], 16)) : src.slice(1);
}

const SHORTHANDS: Record<string, string> = {
  '~': ' ',
  '--': '–',
  '---': '—',
  '-?': '­',
  '...': '…',
};
