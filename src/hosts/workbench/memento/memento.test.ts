// @vitest-environment jsdom
// Tests for memento.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { StorageMemento } from './memento';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('StorageMemento', () => {
  it('keeps values as JSON under its prefix, apart from other prefixes', async () => {
    const memento = StorageMemento.of(document, 'sessionStorage', 'widget:files:');
    expect(memento.get('folders')).toBeUndefined();
    expect(memento.get('folders', [])).toEqual([]);
    await memento.update('folders', ['/a']);
    expect(memento.get('folders')).toEqual(['/a']);
    expect(StorageMemento.of(document, 'sessionStorage', 'widget:files:').get('folders')).toEqual(['/a']);
    expect(StorageMemento.of(document, 'sessionStorage', 'widget:other:').get('folders')).toBeUndefined();
    expect(sessionStorage.getItem('widget:files:folders')).toBe('["/a"]');
  });

  it('forgets a value updated to undefined', async () => {
    const memento = StorageMemento.of(document, 'localStorage', 'global:sync:');
    await memento.update('followCursor', false);
    expect(memento.get('followCursor', true)).toBe(false);
    await memento.update('followCursor', undefined);
    expect(memento.get('followCursor', true)).toBe(true);
    expect(localStorage.getItem('global:sync:followCursor')).toBeNull();
  });

  it('gives defaults and keeps nothing without storage', async () => {
    const memento = new StorageMemento(() => {
      throw new Error('blocked');
    }, 'x:');
    await expect(memento.update('a', 1)).resolves.toBeUndefined();
    expect(memento.get('a', 2)).toBe(2);
    expect(new StorageMemento(() => null, 'x:').get('a')).toBeUndefined();
  });
});
