// Tests for y-delta.ts.
import { describe, expect, it } from 'vitest';
import { deltaToChanges } from './y-delta';

describe('deltaToChanges', () => {
  it('turns retains, deletes and inserts into changes in pre-change coordinates', () => {
    expect(deltaToChanges([{ retain: 2 }, { insert: 'ab' }, { retain: 3 }, { delete: 2 }])).toEqual([
      { from: 2, to: 2, insert: 'ab' },
      { from: 5, to: 7, insert: '' },
    ]);
  });

  it('merges a deletion and an insertion at the same spot into one replacement', () => {
    expect(deltaToChanges([{ retain: 1 }, { delete: 3 }, { insert: 'x' }])).toEqual([{ from: 1, to: 4, insert: 'x' }]);
    expect(deltaToChanges([{ retain: 1 }, { insert: 'x' }, { delete: 3 }])).toEqual([{ from: 1, to: 4, insert: 'x' }]);
  });

  it('ignores trailing retains and empty deltas', () => {
    expect(deltaToChanges([{ retain: 4 }])).toEqual([]);
    expect(deltaToChanges([])).toEqual([]);
  });
});
