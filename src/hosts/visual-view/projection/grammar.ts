// What the projection knows about Typst constructs: the registered node and mark specs, and the tables derived from
// them (which syntax and calls project to what, how edited nodes print). See projection.ts.
import type { SyntaxNode } from '@lezer/common';
import type { AnyExtension, Attribute } from '@tiptap/core';
import type { Mark, Node, NodeType, Schema } from '@tiptap/pm/model';
import type { Disposable } from '../../../core/disposable/disposable';
import type { Printer } from './printing';

/** An inline node and the source range it shows; source between placed nodes is hidden syntax. */
export interface Placed {
  node: Node;
  from: number;
  to: number;
}

/** A function call: its `FuncCall` node, the function's name and arguments, and the source it spans (with a `#`). */
export interface Call {
  node: SyntaxNode;
  name: string;
  /** The children of its `Args` node: `(`, arguments, separators, `)` and trailing content blocks. */
  args: SyntaxNode[];
  from: number;
  to: number;
}

/**
 * What projectors get to build nodes from Typst syntax: the source, the schema, and the framework's own
 * steps (blocks of a content block, inline content, textblocks that print their source while untouched).
 */
export interface ProjectionContext {
  readonly schema: Schema;
  readonly source: string;
  /** The source of `range`. */
  text(range: { from: number; to: number }): string;
  /** `call` (a `FuncCall`) read as a call; `from`..`to` is the call's own source. */
  call(call: SyntaxNode): Call;
  /** A call (a `FuncCall` without `#`, e.g. a figure's body) as the block its projectors make of it, or null. */
  blockCall(call: SyntaxNode): Node | null;
  /** The blocks of a closed content block `[..]` (an empty paragraph if there are none), and the source they cover. */
  blocks(content: SyntaxNode): { content: Node[]; from: number; to: number };
  /** Projects inline syntax (a textblock's content), each node carrying `marks`. */
  inline(nodes: readonly SyntaxNode[], marks?: readonly Mark[]): Placed[];
  /** Whether markup `nodes` are one paragraph: no paragraph break, no block of its own (heading, list item). */
  isOneParagraph(nodes: readonly SyntaxNode[]): boolean;
  /**
   * A textblock whose `attrs.src` starts at source offset `from`; while untouched it prints `src` verbatim. Its
   * content ends at `contentTo` (default: the end of `src`); syntax after that closes the block (a code fence).
   */
  textblock(block: { type: string; attrs: { src: string } & Record<string, unknown>; contentTo?: number }, from: number, content: Placed[]): Node;
  /** A node that prints `attrs.src` while untouched (a list item: its marker, then its only child). */
  pristine(type: string, attrs: Record<string, unknown>, content?: Node[]): Node;
  /** Verbatim inline Typst: a raw inline box. */
  raw(src: string, marks?: readonly Mark[]): Node;
  /** Counts up from 0 within the textblock being projected (equal neighbouring marks stay apart by such an `id`). */
  serial(): number;
}

/** Block syntax that always stands alone (`Heading`, `ListItem`): the block, or null to let the next projector try. */
export interface BlockSyntaxProjector {
  project(p: ProjectionContext, node: SyntaxNode, sep: string | null): Node | null;
  /** A label right after it (same line or the next, then a paragraph break or a block) is its label: headings. */
  takesLabel?: boolean;
}

/** A run of markup that is exactly `node` (e.g. raw text over several lines): a block, or null. */
export type RunProjector = (p: ProjectionContext, node: SyntaxNode, sep: string | null) => Node | null;

/** A run that is exactly one `#name(..)` call: the block (checking the arguments first), or null. */
export type BlockCallProjector = (p: ProjectionContext, call: Call, sep: string | null) => Node | null;

/** One piece of inline syntax: a node showing all of its source, the placed content (marks), or null (raw). */
export type InlineProjector = (p: ProjectionContext, node: SyntaxNode, marks: readonly Mark[]) => Node | Placed[] | null;

/** A call after `#` in running text (`#link("url")[text]`). */
export interface InlineCallProjector {
  /** Whether `call` is this construct's: it then belongs in running text (makes its run a paragraph), even if left raw. */
  matches(p: ProjectionContext, call: Call): boolean;
  /** The node or placed content, or null to leave the call raw (or to the next projector). */
  project(p: ProjectionContext, call: Call, marks: readonly Mark[]): Node | Placed[] | null;
}

/** How a spec reads Typst: by syntax, by call, by the inline syntax it models. */
export interface ProjectionSpec {
  /** Block syntax standing alone, by Lezer node name (`Heading`, `ListItem`, `EnumItem`); tried in registration order. */
  readonly blockSyntax?: Readonly<Record<string, BlockSyntaxProjector>>;
  /** A run that is exactly one syntax node of this name (`Raw`: a code block); tried before the run becomes prose. */
  readonly runSyntax?: Readonly<Record<string, RunProjector>>;
  /** Block calls by function name; `*` takes any call no projector names. */
  readonly blockCalls?: Readonly<Record<string, BlockCallProjector>>;
  /** Inline syntax by Lezer node name (`Strong`, `Ref`); such syntax makes a run prose. */
  readonly inlineSyntax?: Readonly<Record<string, InlineProjector>>;
  /** Calls in running text, tried in registration order. */
  readonly inlineCalls?: readonly InlineCallProjector[];
  /** Fires when what this spec projects changed (styles declared or removed): views project their document again. */
  onDidChange?(listener: () => void): Disposable;
}

/** Prints an edited (not untouched) block that starts at document position `pos` inside `parent`. */
export type BlockPrinter = (out: Printer, node: Node, pos: number, parent: Node) => void;

/** What the framework knows of a node type: its schema part, how it is read from Typst and printed back. */
export interface NodeGrammar extends ProjectionSpec {
  /** The node type's name. A second spec of the same name extends the first (another printer, more projectors). */
  readonly name: string;
  /** The Tiptap extension defining it (schema, node view, commands, keymap, input rules); omitted if another spec's defines it too. */
  readonly extension?: AnyExtension;
  /** Attributes the host adds to the node type: source anchors such as `src`, `sep`, `marker`, `layout` (never rendered). */
  readonly attributes?: Readonly<Record<string, Attribute>>;
  /** Those of its attributes that a re-projection may change in place (`marker`, `layout`), like `src` and `sep`. */
  readonly anchors?: readonly string[];
  /** Keeps its DOM (and what is inside) while a new version renders the same, as after every outside edit its `src` changes. */
  readonly keepsDom?: boolean;
  /** A label may follow it (`<intro>`): it gets the `label` attribute, printed after it. */
  readonly labelled?: boolean;
  /** Shown as a box a remote caret inside outlines: `code` edits its `src` in a nested code editor (the host's raw box). */
  readonly box?: 'code' | 'widget';
  /** Consecutive nodes of this type form a container, of the type this returns (list items: their list). */
  container?(item: Node): string;
  /** Prints the node when edited; default for textblocks: their inline content. Block atoms print their `src`. */
  readonly print?: BlockPrinter;
  /** The source of an inline atom (`@intro`). */
  printAtom?(node: Node): string;
  /** Text printed right after this inline atom, escaped where it would continue the atom's syntax (`@intro\s`). */
  escapeAfter?(node: Node, text: string): string;
}

/** What a formatted span starts and ends with, and the printed characters around it. */
export interface Around {
  before: string | undefined;
  after: string | undefined;
  first: string;
  last: string;
  /** The span's text, as the document shows it. */
  text: string;
}

/** What the framework knows of a mark type (bold, a link, a margin note's range): schema part, reading and printing. */
export interface MarkGrammar extends ProjectionSpec {
  readonly name: string;
  /** The Tiptap extension defining it; omitted if another spec's defines it too. */
  readonly extension?: AnyExtension;
  /** The syntax around a formatted span: `*…*`, or `#strong[…]` where delimiters would not work. */
  print(mark: Mark, around: Around): { open: string; close: string };
  /** Raw text: its text prints as is (no escapes), innermost, closed and reopened around other formatting (inline code). */
  readonly raw?: boolean;
  /** Prints nothing around `text`, Typst reading it back as this mark all the same (a bare URL). */
  printsBare?(mark: Mark, text: string, around: Around): boolean;
}

/** The specs of a schema, merged by name, and the lookups the framework derives from them. */
export class Grammar {
  private readonly nodes = new Map<string, NodeGrammar>();
  private readonly marks = new Map<string, MarkGrammar>();
  private readonly blockSyntaxes = new Map<string, BlockSyntaxProjector[]>();
  private readonly runSyntaxes = new Map<string, RunProjector[]>();
  private readonly calls = new Map<string, BlockCallProjector[]>();
  private readonly inlineSyntaxes = new Map<string, InlineProjector>();
  private readonly inlineCallList: InlineCallProjector[] = [];
  private readonly all: readonly ProjectionSpec[];
  /** Attributes a re-projection may change in place; ignored when documents are compared. */
  readonly anchors = new Set(['src', 'sep', 'lead', 'trail', 'label']);

  constructor(nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[]) {
    for (const spec of nodes) {
      this.nodes.set(spec.name, { ...this.nodes.get(spec.name), ...spec });
      for (const anchor of spec.anchors ?? []) this.anchors.add(anchor);
    }
    for (const spec of marks) this.marks.set(spec.name, { ...this.marks.get(spec.name), ...spec });
    this.all = [...nodes, ...marks];
    for (const spec of this.all) this.addProjectors(spec);
  }

  /** The grammar `attach` gave `schema`. */
  static of(schema: Schema): Grammar {
    const grammar = schema.cached.typstGrammar as Grammar | undefined;
    if (!grammar) throw new Error('No Typst grammar attached to this schema (see attachGrammar)');
    return grammar;
  }

  /** Makes `grammar` the one `project` and `print` use for documents of `schema`. */
  static attach(schema: Schema, grammar: Grammar): void {
    schema.cached.typstGrammar = grammar;
  }

  node(type: NodeType | string): NodeGrammar | undefined {
    return this.nodes.get(typeof type === 'string' ? type : type.name);
  }

  mark(name: string): MarkGrammar | undefined {
    return this.marks.get(name);
  }

  /** Projectors of block syntax `name`, in registration order (none: not a block of its own). */
  blockSyntax(name: string): readonly BlockSyntaxProjector[] {
    return this.blockSyntaxes.get(name) ?? [];
  }

  runSyntax(name: string): readonly RunProjector[] {
    return this.runSyntaxes.get(name) ?? [];
  }

  /** The projectors of calls to `name`: those naming it, else those taking any call. */
  blockCalls(name: string): readonly BlockCallProjector[] {
    return this.calls.get(name) ?? this.calls.get('*') ?? [];
  }

  inlineSyntax(name: string): InlineProjector | undefined {
    return this.inlineSyntaxes.get(name);
  }

  inlineCalls(): readonly InlineCallProjector[] {
    return this.inlineCallList;
  }

  /** The specs whose projection can change after the fact (see `ProjectionSpec.onDidChange`). */
  changing(): ProjectionSpec[] {
    return this.all.filter((spec) => spec.onDidChange);
  }

  private addProjectors(spec: ProjectionSpec): void {
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
    for (const [name, projector] of Object.entries(spec.blockSyntax ?? {})) add(this.blockSyntaxes, name, projector);
    for (const [name, projector] of Object.entries(spec.runSyntax ?? {})) add(this.runSyntaxes, name, projector);
    for (const [name, projector] of Object.entries(spec.blockCalls ?? {})) add(this.calls, name, projector);
    for (const [name, projector] of Object.entries(spec.inlineSyntax ?? {})) this.inlineSyntaxes.set(name, projector);
    this.inlineCallList.push(...(spec.inlineCalls ?? []));
  }
}
