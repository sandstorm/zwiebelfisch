// How a label is described: in reference chips' hints and the @ list.
// See ../labels.ts.
import type { LabelInfo } from './label-index';
import type { LabelKind } from './scan';

/** What a label labels, in words: "Section · Introduction", "Equation"; null if that is unknown (or a bibliography key). */
export function describeLabel(label: LabelInfo): string | null {
  const kind = label.kind && KIND_NAMES[label.kind];
  if (!kind) return null;
  return label.title ? `${kind} · ${shorten(label.title)}` : kind;
}

const KIND_NAMES: Partial<Record<LabelKind, string>> = {
  heading: 'Section',
  figure: 'Figure',
  table: 'Table',
  listing: 'Listing',
  equation: 'Equation',
};

function shorten(title: string): string {
  if (title.length <= MAX_TITLE) return title;
  const cut = title.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Titles longer than this are cut at a word. */
const MAX_TITLE = 36;
