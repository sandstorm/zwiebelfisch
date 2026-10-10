/**
 * Turns Typst source written inside an HTML element into the source itself:
 * drops the newline after the opening tag and the trailing indentation before
 * the closing tag, and removes the indentation common to all non-blank lines.
 * The result ends with a single newline (or is empty).
 */
export function inlineSource(text: string): string {
  const lines = text.replace(/^\r?\n/, '').split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return '';
  const indents = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)![0].length);
  const indent = Math.min(...indents);
  return lines.map((line) => line.slice(indent).trimEnd() === '' ? '' : line.slice(indent)).join('\n') + '\n';
}
