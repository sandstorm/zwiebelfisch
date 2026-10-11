// Card layout: where the notes gutter puts its cards, near their anchors without overlap. See ../visual-editor/notes-gutter/notes-gutter.ts.

/**
 * The top of each card (in input order) so that cards follow their anchors
 * without overlapping, like comments beside a document: each card starts at
 * its anchor or right below the card before it. The active card stays at its
 * anchor, and the cards above it move up as far as needed.
 */
export function layoutCards(cards: readonly CardBox[], { gap, active, top = -Infinity }: CardLayoutOptions): number[] {
  const order = cards.map((_, i) => i).sort((a, b) => cards[a].anchor - cards[b].anchor);
  const tops = new Array<number>(cards.length);
  const start = active === undefined ? 0 : Math.max(0, order.indexOf(active));
  for (let k = start; k < order.length; k++) {
    const i = order[k];
    tops[i] = k === start ? cards[i].anchor : Math.max(cards[i].anchor, bottom(order[k - 1]) + gap);
  }
  for (let k = start - 1; k >= 0; k--) {
    const i = order[k];
    tops[i] = Math.min(cards[i].anchor, tops[order[k + 1]] - cards[i].height - gap);
  }
  // keep below `top`, pushing later cards down again where that makes them overlap
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    tops[i] = Math.max(tops[i], top, k === 0 ? -Infinity : bottom(order[k - 1]) + gap);
  }
  return tops;

  function bottom(i: number): number {
    return tops[i] + cards[i].height;
  }
}

/** A card in the notes gutter: where its anchor is and how tall it is (same unit, e.g. px). */
export interface CardBox {
  anchor: number;
  height: number;
}

export interface CardLayoutOptions {
  /** Space between two cards. */
  gap: number;
  /** Index of the card that sits exactly at its anchor; cards above it move up to make room. */
  active?: number;
  /** No card starts above this (default: no limit). */
  top?: number;
}
