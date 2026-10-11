// calculateNewStyleChange: the stub "New style…" appends to the styles file. See ../styles.ts.
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, SourceRange, type TextChange } from '../../../core/typst-document/typst-document';
import { scanStyles } from './discover';

/** Where "New style…" puts new styles while the project declares none. */
export const STYLES_FILE = ProjectPath.of('/styles.typ');

/**
 * The change that appends a new block style called `label` to the styles file (`text` is the file's current
 * text, '' for a new file: then `insert` is the whole file), and where its definition lies afterwards, for showing
 * it. Its function is named after the label (`New style` → `new-style`), numbered when taken (`new-style-2`,
 * labelled `New style 2`).
 */
export function calculateNewStyleChange(text: string, label = 'New style'): { change: TextChange; definition: SourceRange } {
  const taken = new Set(scanStyles(text).map((style) => style.name));
  const base = styleName(label);
  let name = base;
  let number = 1;
  while (taken.has(name) || new RegExp(`#let ${name}\\b`).test(text)) name = `${base}-${++number}`;
  const shown = number === 1 ? label.trim() : `${label.trim()} ${number}`;
  const stub = `/// @style block ${shown}\n#let ${name}(body) = block(inset: 8pt, stroke: 0.5pt + luma(180), body)\n`;
  const lead = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const from = text.length + lead.length;
  const end = SourceOffset.of(text.length);
  return { change: { from: end, to: end, insert: lead + stub }, definition: SourceRange.of({ from, to: from + stub.length - 1 }) };
}

/** A Typst function name for a style called `label`: its words in lower case joined by `-`, starting with a letter. */
function styleName(label: string): string {
  const words = label.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return /^\p{L}/u.test(words) ? words : `style${words ? `-${words}` : ''}`;
}
