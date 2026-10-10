// Which labels the @ list offers for a query, and how a label is described (chip hints, list entries).
// See model.ts.
import type { LabelInfo } from './label-index';
import type { LabelKind } from './scan';

/**
 * The labels to offer for `query` (what follows the typed `@`), each name
 * once: names starting with the query first, then names containing it, then
 * labels whose title contains it; case is ignored, the project's order kept.
 */
export function labelChoices(labels: readonly LabelInfo[], query: string, limit = 8): LabelInfo[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const unique = labels.filter((label) => !seen.has(label.name) && seen.add(label.name));
  const rank = (label: LabelInfo) => {
    const name = label.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return label.title?.toLowerCase().includes(q) ? 2 : 3;
  };
  return unique
    .map((label) => ({ label, rank: rank(label) }))
    .filter(({ rank }) => rank < 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ label }) => label);
}

const KIND_NAMES: Partial<Record<LabelKind, string>> = {
  heading: 'Section',
  figure: 'Figure',
  table: 'Table',
  listing: 'Listing',
  equation: 'Equation',
};

/** Titles longer than this are cut at a word. */
const MAX_TITLE = 36;

/** What a label labels, in words: "Section · Introduction", "Equation"; null if that is unknown (or a bibliography key). */
export function describeLabel(label: LabelInfo): string | null {
  const kind = label.kind && KIND_NAMES[label.kind];
  if (!kind) return null;
  return label.title ? `${kind} · ${shorten(label.title)}` : kind;
}

function shorten(title: string): string {
  if (title.length <= MAX_TITLE) return title;
  const cut = title.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
