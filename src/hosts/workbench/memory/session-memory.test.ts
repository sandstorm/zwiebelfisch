// @vitest-environment jsdom
// Tests for session-memory.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { SessionMemory } from './session-memory';

afterEach(() => sessionStorage.clear());

describe('SessionMemory', () => {
  it('remembers values for the session, apart by widget key and name', () => {
    const memory = new SessionMemory(document, 'widget').remember<string[]>('folders');
    expect(memory.load()).toBeNull();
    memory.save(['/a']);
    expect(memory.load()).toEqual(['/a']);
    expect(new SessionMemory(document, 'widget').remember('folders').load()).toEqual(['/a']);
    expect(new SessionMemory(document, 'other').remember('folders').load()).toBeNull();
    expect(sessionStorage.getItem('widget:folders')).toBe('["/a"]');
  });
});
