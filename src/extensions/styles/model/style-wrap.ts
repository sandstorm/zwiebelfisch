// calculateStyleWrap: a style applied in the Source editor, as text. See ../styles.ts.
import { SourceOffset, type SourceRange, type TextChange } from '../../../core/typst-document/typst-document';

/**
 * The changes that put `range` of a Typst text into a call of style function `name`: `#name[` before it and `]` after
 * it (an empty range: `#name[]`, to type into). `content` is where the wrapped text is afterwards, with `shift`
 * characters added before it by other changes made with these (an import at the top).
 */
export function calculateStyleWrap(name: string, range: SourceRange, shift = 0): { changes: TextChange[]; content: SourceRange } {
  const open = `#${name}[`;
  const changes: TextChange[] =
    range.from === range.to
      ? [{ from: range.from, to: range.from, insert: `${open}]` }]
      : [
          { from: range.from, to: range.from, insert: open },
          { from: range.to, to: range.to, insert: ']' },
        ];
  const from = SourceOffset.of(range.from + shift + open.length);
  return { changes, content: { from, to: SourceOffset.of(from + range.to - range.from) } };
}
