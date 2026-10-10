// insertImage: the source edit that inserts `#image(..)` for a project image. See files.ts.
import type { TextChange } from '../../core/typst-document/typst-document';

/**
 * The edit that inserts `#image("path")` as a paragraph of its own, after the
 * line containing `offset` (or at the end), separated by blank lines.
 */
export function insertImage(text: string, offset: number, path: string): TextChange {
  const lineEnd = text.indexOf('\n', offset);
  const at = lineEnd === -1 ? text.length : lineEnd;
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before === '' ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  // `after` is empty or starts with the newline that ends the cursor's line.
  const trail = after === '' ? '\n' : after === '\n' || after.startsWith('\n\n') ? '' : '\n';
  const markup = `#image("${path.replace(/[\\"]/g, (c) => `\\${c}`)}")`;
  return { from: at, to: at, insert: `${lead}${markup}${trail}` };
}
