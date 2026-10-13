// A label named after a figure's caption. See labels in ../labels.ts.

/**
 * A label for a figure captioned `caption`: `prefix` and the caption's first few words that say something, in
 * lowercase and joined by `-` (`fig:` + "The company's logo." → `fig:company-logo`); `-2`, `-3`, … where the name is
 * `taken`. Null for a caption without a word.
 */
export function captionLabel(prefix: string, caption: string, taken: (name: string) => boolean): string | null {
  const words = caption
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/'s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  const meaningful = words.filter((word) => !FILLERS.has(word));
  const stem = (meaningful.length > 0 ? meaningful : words).slice(0, MAX_WORDS).join('-');
  if (stem === '') return null;
  for (let n = 1; ; n++) {
    const name = `${prefix}${stem}${n === 1 ? '' : `-${n}`}`;
    if (!taken(name)) return name;
  }
}

/** Words a label is shorter without. */
const FILLERS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'by', 'at', 'from', 'der', 'die', 'das', 'und', 'von', 'mit']);

const MAX_WORDS = 3;
