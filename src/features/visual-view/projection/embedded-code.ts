// Expressions written in code (a table cell like `ms(18)`) and their markup form (`#ms(18)`). See projection.ts.
import { typstParser } from 'codemirror-lang-typst/lezer';

/**
 * Whether `code`, an expression in code (an argument), reads the same after
 * a `#` in markup: one embedded expression, nothing after it, no errors.
 * `ms(18)`, `x.y`, `"text"`, `1pt` and `$x^2$` do; `-1`, `a + b` or a
 * comment do not.
 */
export function isEmbeddable(code: string): boolean {
  if (code.trim() !== code || code === '') return false;
  const markup = `#${code}`;
  const tree = typstParser.parse(markup);
  const hash = tree.topNode.firstChild;
  const expression = hash?.name === 'Hash' ? hash.nextSibling : null;
  const whole = expression?.from === 1 && expression.to === markup.length && !expression.nextSibling;
  if (!whole || /Comment/.test(expression.name)) return false;
  let broken = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError || node.name === 'Error') broken = true;
    },
  });
  return !broken;
}

/** The markup that shows what `code` (an embeddable expression) does: `#code`, or an equation as it is. */
export function markupSource(code: string): string {
  return code.startsWith('$') ? code : `#${code}`;
}
