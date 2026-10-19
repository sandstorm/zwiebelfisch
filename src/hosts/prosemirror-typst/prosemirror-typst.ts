import type { SyntaxNode } from '@lezer/common';
import type { AnyExtension } from '@tiptap/core';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import type { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import type { Event } from '../../core/event-emitter/event-emitter';

/**
 * Conversion between Typst text and the Visual editor's ProseMirror document, built from specs: this one is a node type
 * of the document, its Tiptap extension (`Node.create(..)`: schema, attributes, node view, commands, keymap, priority;
 * omitted if another spec's extension defines it too) and its Typst. A second spec of the same name extends the first
 * (another `toTypst`, more parse rules).
 *
 * Used by:
 * - the Visual editor (`documentExtensions`, `attachGrammar`)
 * - tests (`createSchema`)
 *
 * Guarantees:
 * - `serializeToTypst(parseTypst(text)) === text` for any text: untouched nodes print their source byte for byte
 * - an edit changes only the source of what it touched (`typstChanges`); a fresh parse is applied as the smallest
 *   replacement (`applyTypstChanges`)
 * - `sourceToPos` and `posToSource` map between source offsets and document positions, down to the character
 * - syntax no spec takes stays raw Typst, kept verbatim
 */
export interface DocumentNodeSpec {
  readonly name: string;
  readonly tiptap?: AnyExtension;
  readonly typst?: TypstNodeConversion;
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

export { createSchema, documentExtensions, starterKitPart, parseTypst, serializeToTypst, escapeTypst, attachGrammar, documentNodeSpec, onDidChangeGrammar, sourceToPos, posToSource, applyTypstChanges, typstChanges } from './prosemirror-typst-impl';
