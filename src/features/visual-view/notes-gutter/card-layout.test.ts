import { describe, expect, it } from 'vitest';
import { layoutCards } from './card-layout';

const card = (anchor: number, height: number) => ({ anchor, height });

describe('layoutCards', () => {
  it('puts every card at its anchor while they do not overlap', () => {
    expect(layoutCards([card(10, 20), card(50, 20), card(100, 30)], { gap: 8 })).toEqual([10, 50, 100]);
  });

  it('pushes a card down below the one before it', () => {
    expect(layoutCards([card(10, 40), card(20, 20), card(30, 10)], { gap: 8 })).toEqual([10, 58, 86]);
  });

  it('places cards in anchor order, returning positions in input order', () => {
    expect(layoutCards([card(30, 10), card(10, 40)], { gap: 8 })).toEqual([58, 10]);
  });

  it('keeps the active card at its anchor and moves the ones above it up', () => {
    // without an active card: 0, 48, 96
    expect(layoutCards([card(0, 40), card(10, 40), card(20, 40)], { gap: 8, active: 2 })).toEqual([-76, -28, 20]);
    expect(layoutCards([card(0, 40), card(10, 40), card(20, 40)], { gap: 8, active: 1 })).toEqual([-38, 10, 58]);
  });

  it('does not move cards above the active one that already fit', () => {
    expect(layoutCards([card(0, 10), card(100, 40), card(110, 40)], { gap: 8, active: 2 })).toEqual([0, 62, 110]);
  });

  it('keeps cards at or below the top when asked', () => {
    expect(layoutCards([card(0, 40), card(10, 40), card(20, 40)], { gap: 8, active: 1, top: 0 })).toEqual([0, 48, 96]);
  });

  it('handles no cards', () => {
    expect(layoutCards([], { gap: 8 })).toEqual([]);
  });
});
