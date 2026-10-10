// Style discovery: the functions a Typst file declares as paragraph or text styles (`/// @style …`). See styles.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { ProjectFiles } from '../../core/project/project';

/** Wraps blocks (`#note[..]` around paragraphs) or inline text (`#key[..]` in a sentence). */
export type StyleKind = 'paragraph' | 'text';

/** A style declared in a file: the function's name, its kind and the name people see. */
export interface FoundStyle {
  name: string;
  kind: StyleKind;
  label: string;
}

/** A style of the project: where it is declared, too. */
export interface Style extends FoundStyle {
  path: string;
}

const DECLARATION = /^\/\/\/\s*@style\s+(paragraph|text)\b\s*(.*)$/;

/**
 * The styles `text` declares, in source order: a top-level `#let name(body) = …`
 * (one positional parameter, the content; named parameters with defaults are
 * fine) right below a doc comment line `/// @style paragraph|text [Label]`
 * (other `///` lines may come before it, as tidy writes them). Without a label
 * a style is called by its name.
 */
export function scanStyles(text: string): FoundStyle[] {
  const styles: FoundStyle[] = [];
  let declared: { kind: StyleKind; label: string } | null = null;
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'LineComment') {
      const match = DECLARATION.exec(text.slice(node.from, node.to).trim());
      declared = match ? { kind: match[1] as StyleKind, label: match[2].trim() } : declared;
    } else if (node.name === 'LetBinding' && declared) {
      const name = styleFunction(text, node);
      if (name) styles.push({ name, kind: declared.kind, label: declared.label || name });
      declared = null;
    } else if (node.name !== 'Hash' && !(node.name === 'Space' && !text.slice(node.from, node.to).includes('\n\n'))) {
      declared = null;
    }
  }
  return styles;
}

/** The styles declared in the project's Typst files, by file in the project's order. */
export function discoverStyles(files: ProjectFiles): Style[] {
  return Object.entries(files).flatMap(([path, content]) =>
    path.endsWith('.typ') && typeof content === 'string' ? scanStyles(content).map((style) => ({ ...style, path })) : [],
  );
}

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
