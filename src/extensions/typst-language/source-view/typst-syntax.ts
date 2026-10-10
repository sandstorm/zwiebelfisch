// Typst syntax highlighting and indentation for CodeMirror (the Source views and the Visual view's raw boxes). See ../typst-language.ts.
import { indentService, LanguageSupport, syntaxTree, type IndentContext } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { typst_lezer, typstLezerIndentService, typstLezerLinter } from 'codemirror-lang-typst/lezer';

/**
 * Typst language support for CodeMirror without the Lezer syntax linter: the
 * compiler's diagnostics are the single source of errors, so nothing is
 * reported twice. Its indentation service is wrapped so that a construct
 * closed right before the cursor does not indent the next line.
 */
export function typstLanguage(): LanguageSupport {
  const lezer = typst_lezer();
  const support = (lezer.support as readonly Extension[])
    .filter((extension) => extension !== typstLezerLinter)
    .map((extension) => (extension === typstLezerIndentService ? closedAwareIndentService : extension));
  return new LanguageSupport(lezer.language, support);
}

type IndentFn = (context: IndentContext, pos: number) => number | null | undefined;

/** The package's indentation function (only exported as a facet value). */
const packageIndent: IndentFn = EditorState.create({ extensions: typstLezerIndentService }).facet(indentService)[0];

const CLOSING: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/**
 * codemirror-lang-typst 0.6.0 treats a delimited construct that ends exactly
 * at the cursor as unfinished, so Enter after `#set page(width: 16cm)` indents
 * the next line to the first argument. Such positions fall back to the syntax
 * tree's indentation (that of the enclosing construct) instead.
 */
const closedAwareIndentService = indentService.of((context, pos) =>
  closesAt(context.state, pos) ? undefined : packageIndent(context, pos),
);

/** Whether the bracket right before `pos` (spaces aside) closes a construct that ends there. */
function closesAt(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos);
  let end = pos;
  while (end > line.from && /[\t ]/.test(state.sliceDoc(end - 1, end))) end--;
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(end, -1); node; node = node.parent) {
    if (node.to !== end) return false;
    const closing = CLOSING[state.sliceDoc(node.from, node.from + 1)];
    if (closing && node.to - node.from > 1 && state.sliceDoc(node.to - 1, node.to) === closing) return true;
  }
  return false;
}
