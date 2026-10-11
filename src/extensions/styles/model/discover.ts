// Style discovery: the functions a Typst file declares as block or inline styles (`/// @style …`). See styles in ../styles.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { ProjectPath } from '../../../core/paths/paths';

/**
 * The styles `text` declares, in source order: a top-level `#let name(body) = …`
 * (one positional parameter, the content; named parameters with defaults are
 * fine) right below a doc comment line `/// @style block|inline [Label]`
 * (other `///` lines may come before it, as tidy writes them). Without a label
 * a style is called by its name.
 */
export function scanStyles(text: string): FoundStyle[] {
  const styles: FoundStyle[] = [];
  let declared: Declaration | null = null;
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    const name = node.name === 'LetBinding' && declared ? styleFunction(text, node) : null;
    if (name) styles.push({ name, kind: declared!.kind, label: declared!.label || name });
    declared = nextDeclaration(text, node, declared);
  }
  return styles;
}

/** Wraps blocks (`#note[..]` around paragraphs) or inline text (`#key[..]` in a sentence). */
export type TypstStyleKind = 'block' | 'inline';

/** A style declared in a file: the function's name, its kind and the name people see. */
export interface FoundStyle {
  name: string;
  kind: TypstStyleKind;
  label: string;
}

/** A style of the project: where it is declared, too. */
export interface TypstStyle extends FoundStyle {
  path: ProjectPath;
}

type Declaration = { kind: TypstStyleKind; label: string };

/** The name of a `let name(body, named: ..) = …` binding, if it has exactly one positional parameter. */
function styleFunction(text: string, binding: SyntaxNode): string | null {
  const closure = binding.getChild('Closure');
  const name = closure?.getChild('Ident');
  const params = closure?.getChild('Params');
  if (!name || !params) return null;
  const kinds: string[] = [];
  for (let param = params.firstChild; param; param = param.nextSibling) kinds.push(param.name);
  const positional = kinds.filter((kind) => kind === 'Ident').length;
  const others = kinds.filter((kind) => !['Ident', 'Named', 'LeftParen', 'RightParen', 'Comma', 'Space'].includes(kind));
  return positional === 1 && others.length === 0 ? text.slice(name.from, name.to) : null;
}

/** The `@style` declaration in force after `node`: set by its comment line, kept across other `///` lines, the `#` and line breaks. */
function nextDeclaration(text: string, node: SyntaxNode, declared: Declaration | null): Declaration | null {
  if (node.name === 'LineComment') {
    const match = DECLARATION.exec(text.slice(node.from, node.to).trim());
    return match ? { kind: match[1] as TypstStyleKind, label: match[2].trim() } : declared;
  }
  return node.name === 'Hash' || node.name === 'Space' ? declared : null;
}

const DECLARATION = /^\/\/\/\s*@style\s+(block|inline)\b\s*(.*)$/;
