// newStyle: the stub "New style…" appends to the styles file. See styles.ts.
import { scanStyles } from './discover';

/** Where "New style…" puts new styles while the project declares none. */
export const STYLES_FILE = '/styles.typ';

/**
 * The text of the styles file with a new paragraph style appended (`text` is
 * the file's current text, '' for a new file), and where its definition lies,
 * for showing it. The name is `new-style`, numbered when taken.
 */
export function newStyle(text: string): { text: string; from: number; to: number } {
  const taken = new Set(scanStyles(text).map((style) => style.name));
  let name = 'new-style';
  for (let n = 2; taken.has(name) || new RegExp(`#let ${name}\\b`).test(text); n++) name = `new-style-${n}`;
  const label = name.replace(/^new-style/, 'New style').replace(/-(\d+)$/, ' $1');
  const stub = `/// @style paragraph ${label}\n#let ${name}(body) = block(inset: 8pt, stroke: 0.5pt + luma(180), body)\n`;
  const lead = text === '' ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const from = text.length + lead.length;
  return { text: text + lead + stub, from, to: from + stub.length - 1 };
}
