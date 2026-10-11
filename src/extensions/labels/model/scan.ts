// Reading labels and references out of one file: Typst source (Lezer) or a BibTeX bibliography. See ../labels.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { SourceOffset, type TextChange } from '../../../core/typst-document/typst-document';

export interface Scan {
  labels: FoundLabel[];
  /** How often each label is referenced (`@name`). */
  references: Map<string, number>;
}

/** What a label labels, as far as a cheap look at the source tells. */
export type LabelKind = 'heading' | 'figure' | 'table' | 'listing' | 'equation' | 'bibliography';

/** A label found in a file: its name, what it labels (null: something else) and that element's title, if it has one. */
export interface FoundLabel {
  name: string;
  kind: LabelKind | null;
  title: string | null;
}

/** The labels and references in Typst source. */
export function scanTypst(text: string): Scan {
  const scan: Scan = { labels: [], references: new Map() };
  const cursor = typstParser.parse(text).cursor();
  do {
    if (cursor.name === 'Label') scan.labels.push(labelAt(cursor.node, text));
    if (cursor.name === 'RefMarker') {
      const name = text.slice(cursor.from + 1, cursor.to);
      scan.references.set(name, (scan.references.get(name) ?? 0) + 1);
    }
  } while (cursor.next());
  return scan;
}

/** The entry keys of a BibTeX file (`@book{knuth1984, ..}`), as labels without a title. */
export function scanBibliography(text: string): Scan {
  const keys = [...text.matchAll(/@[a-zA-Z]+\s*\{\s*([^,\s{}]+)\s*,/g)].map((m) => m[1]);
  return { labels: keys.map((name) => ({ name, kind: 'bibliography', title: null })), references: new Map() };
}

/**
 * Where Typst source refers to label `from`: one change per reference,
 * replacing just its name with `to` (supplements stay).
 */
export function calculateReferenceRenames(text: string, from: string, to: string): TextChange[] {
  const edits: TextChange[] = [];
  const cursor = typstParser.parse(text).cursor();
  do {
    if (cursor.name === 'RefMarker' && text.slice(cursor.from + 1, cursor.to) === from) edits.push({ from: SourceOffset.of(cursor.from + 1), to: SourceOffset.of(cursor.to), insert: to });
  } while (cursor.next());
  return edits;
}

/** Where label `name` (`<name>`) is in Typst source; null if it is not there. */
export function findLabel(text: string, name: string): SourceOffset | null {
  const cursor = typstParser.parse(text).cursor();
  do {
    if (cursor.name === 'Label' && text.slice(cursor.from + 1, cursor.to - 1) === name) return SourceOffset.of(cursor.from);
  } while (cursor.next());
  return null;
}

/** A label and the element before it (spaces skipped), which it labels. */
function labelAt(label: SyntaxNode, text: string): FoundLabel {
  const name = text.slice(label.from + 1, label.to - 1);
  let element = label.prevSibling;
  while (element?.name === 'Space') element = element.prevSibling;
  if (element?.name === 'Heading') return { name, kind: 'heading', title: plainText(element.getChild('Markup'), text) };
  if (element?.name === 'Equation') return { name, kind: 'equation', title: null };
  if (element?.name === 'FuncCall' && callee(element, text) === 'figure') return { name, ...figure(element, text) };
  return { name, kind: null, title: null };
}

/** The text a reader sees of some markup, roughly: its words, formatting and code left out; null if there is none. */
function plainText(markup: SyntaxNode | null, text: string): string | null {
  if (!markup) return null;
  const words: string[] = [];
  const visit = (node: SyntaxNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (WORDS.has(child.name)) words.push(text.slice(child.from, child.to));
      else if (child.name === 'Space') words.push(' ');
      else if (child.name === 'Strong' || child.name === 'Emph') visit(child.getChild('Markup') ?? child);
    }
  };
  visit(markup);
  const plain = words.join('').replace(/\s+/g, ' ').trim();
  return plain || null;
}

const WORDS = new Set(['Text', 'SmartQuote', 'Shorthand', 'Ref']);

/** The identifier a call or named argument starts with. */
function callee(node: SyntaxNode, text: string): string {
  const ident = node.getChild('Ident') ?? node.firstChild;
  return ident ? text.slice(ident.from, ident.to) : '';
}

/** A figure's kind (by what it shows: an image, a table, raw text) and its caption. */
function figure(call: SyntaxNode, text: string): { kind: LabelKind; title: string | null } {
  const args: SyntaxNode[] = [];
  for (let arg = call.getChild('Args')?.firstChild ?? null; arg; arg = arg.nextSibling) args.push(arg);
  const body = args.find((arg) => !NOT_BODY.has(arg.name));
  const caption = args.find((arg) => arg.name === 'Named' && callee(arg, text) === 'caption');
  return { kind: figureKind(body, text), title: plainText(caption?.getChild('ContentBlock')?.getChild('Markup') ?? null, text) };
}

const NOT_BODY = new Set(['LeftParen', 'RightParen', 'Comma', 'Space', 'Named']);

function figureKind(body: SyntaxNode | undefined, text: string): LabelKind {
  if (!body) return 'figure';
  return FIGURE_KINDS[body.name === 'FuncCall' ? callee(body, text) : body.name] ?? 'figure';
}

const FIGURE_KINDS: Record<string, LabelKind> = { table: 'table', Raw: 'listing' };
