// Reading labels and references out of one file: Typst source (Lezer) or a BibTeX bibliography. See ../labels.ts.
import type { SyntaxNode } from '@lezer/common';
import { callArguments, calleeName, sourceText, syntaxTree, withHash, type TypstSource } from '../../../core/typst-syntax/typst-syntax';
import { SourceOffset, SourceRange, type TextChange } from '../../../core/typst-document/typst-document';

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
export function scanTypst(source: TypstSource): Scan {
  const text = sourceText(source);
  const scan: Scan = { labels: [], references: new Map() };
  const cursor = syntaxTree(source).cursor();
  do {
    if (cursor.name === 'Label' && labels(cursor.node)) scan.labels.push(labelAt(cursor.node, text));
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
export function calculateReferenceRenames(source: TypstSource, from: string, to: string): TextChange[] {
  const text = sourceText(source);
  const edits: TextChange[] = [];
  const cursor = syntaxTree(source).cursor();
  do {
    if (cursor.name === 'RefMarker' && text.slice(cursor.from + 1, cursor.to) === from) edits.push({ from: SourceOffset.of(cursor.from + 1), to: SourceOffset.of(cursor.to), insert: to });
  } while (cursor.next());
  return edits;
}

/** Where Typst source points to a label: a reference (`@name`, `@name[..]`), or a link to it (`#link(<name>)[..]`). */
export interface LabelLink {
  name: string;
  /** The reference, or the whole `link` call (with its `#`). */
  range: SourceRange;
}

/** The references and the links to labels in Typst source, in order (a reference inside such a link after it). */
export function findLabelLinks(source: TypstSource): LabelLink[] {
  const text = sourceText(source);
  const found: LabelLink[] = [];
  const cursor = syntaxTree(source).cursor();
  do {
    if (cursor.name === 'Ref') {
      const marker = cursor.node.getChild('RefMarker');
      if (marker) found.push({ name: text.slice(marker.from + 1, marker.to), range: SourceRange.of(cursor) });
    }
    if (cursor.name === 'FuncCall' && calleeName(cursor.node, text) === 'link') {
      const [target] = callArguments(cursor.node);
      if (target?.name === 'Label') found.push({ name: text.slice(target.from + 1, target.to - 1), range: withHash(cursor.node) });
    }
  } while (cursor.next());
  return found;
}

/** Where label `name` (`<name>`) is in Typst source; null if it is not there. */
export function findLabel(source: TypstSource, name: string): SourceOffset | null {
  const text = sourceText(source);
  const cursor = syntaxTree(source).cursor();
  do {
    if (cursor.name === 'Label' && labels(cursor.node) && text.slice(cursor.from + 1, cursor.to - 1) === name) return SourceOffset.of(cursor.from);
  } while (cursor.next());
  return null;
}

/** Whether a label labels what is before it: in markup, not a label value in code (`#link(<intro>)`). */
function labels(label: SyntaxNode): boolean {
  return label.parent?.name !== 'Args';
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
