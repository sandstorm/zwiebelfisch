// The figures of Typst source with their caption, kind and label (search everywhere lists them). See ../figures.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { callArguments, calleeName, namedArgument } from '../../../core/typst-syntax/typst-syntax';
import { SourceOffset } from '../../../core/typst-document/typst-document';

/** Every `#figure(..)` of `text` in markup, in source order, that has a caption or a label. */
export function findFigures(text: string): FoundFigure[] {
  const figures: FoundFigure[] = [];
  typstParser.parse(text).iterate({
    enter: (node) => {
      const hash = node.node.prevSibling;
      if (node.name !== 'FuncCall' || hash?.name !== 'Hash' || hash.to !== node.from || calleeName(node.node, text) !== 'figure') return;
      const figure = describe(node.node, text, SourceOffset.of(hash.from));
      if (figure.caption !== null || figure.label !== null) figures.push(figure);
    },
  });
  return figures;
}

/** What a figure shows, by its body: a table, code (a listing), anything else. */
export type FigureKind = 'Figure' | 'Table' | 'Listing';

/** A `#figure(..)`: its caption as written (whitespace collapsed; null without one), kind, label, and where it starts. */
export interface FoundFigure {
  readonly caption: string | null;
  readonly kind: FigureKind;
  readonly label: string | null;
  readonly at: SourceOffset;
}

function describe(call: SyntaxNode, text: string, at: SourceOffset): FoundFigure {
  const block = namedArgument(call, 'caption', text);
  const caption = block?.name === 'ContentBlock' ? block.getChild('Markup') : null;
  const body = callArguments(call).find((arg) => arg.name !== 'Named');
  return { caption: caption ? collapse(text.slice(caption.from, caption.to)) || null : null, kind: kindOf(body, text), label: labelAfter(call, text), at };
}

function collapse(markup: string): string {
  return markup.replace(/\s+/g, ' ').trim();
}

function kindOf(body: SyntaxNode | undefined, text: string): FigureKind {
  if (body?.name === 'Raw') return 'Listing';
  return body?.name === 'FuncCall' && calleeName(body, text) === 'table' ? 'Table' : 'Figure';
}

/** The label right after the call (spaces between), if any. */
function labelAfter(call: SyntaxNode, text: string): string | null {
  let next = call.nextSibling;
  while (next?.name === 'Space') next = next.nextSibling;
  return next?.name === 'Label' ? text.slice(next.from + 1, next.to - 1) : null;
}
