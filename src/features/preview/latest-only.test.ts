import { describe, expect, it } from 'vitest';
import { LatestOnly } from './latest-only';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('LatestOnly', () => {
  it('runs a value right away when idle', async () => {
    const seen: number[] = [];
    const latest = new LatestOnly<number>(async (value) => void seen.push(value));
    latest.push(1);
    await latest.idle();
    expect(seen).toEqual([1]);
  });

  it('runs only the newest of the values pushed while one is running', async () => {
    const seen: number[] = [];
    const gate = deferred();
    const latest = new LatestOnly<number>(async (value) => {
      seen.push(value);
      if (value === 1) await gate.promise;
    });
    latest.push(1);
    latest.push(2);
    latest.push(3);
    latest.push(4);
    gate.resolve();
    await latest.idle();
    expect(seen).toEqual([1, 4]);
  });

  it('tells the running task whether a newer value is waiting', async () => {
    const superseded: boolean[] = [];
    const gate = deferred();
    const latest = new LatestOnly<number>(async (value, isSuperseded) => {
      if (value === 1) await gate.promise;
      superseded.push(isSuperseded());
    });
    latest.push(1);
    latest.push(2);
    gate.resolve();
    await latest.idle();
    expect(superseded).toEqual([true, false]);
  });

  it('calls onIdle once the queue has drained', async () => {
    let idleCalls = 0;
    const latest = new LatestOnly<number>(async () => {}, { onIdle: () => idleCalls++ });
    latest.push(1);
    latest.push(2);
    await latest.idle();
    expect(idleCalls).toBe(1);
  });

  it('waits at least `interval` ms between two runs', async () => {
    const times: number[] = [];
    const latest = new LatestOnly<number>(async () => void times.push(Date.now()), { interval: 40 });
    latest.push(1);
    await latest.idle();
    latest.push(2);
    await latest.idle();
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(35);
  });

  it('keeps going after a failing run', async () => {
    const seen: number[] = [];
    const latest = new LatestOnly<number>(async (value) => {
      if (value === 1) throw new Error('boom');
      seen.push(value);
    });
    latest.push(1);
    await latest.idle();
    latest.push(2);
    await latest.idle();
    expect(seen).toEqual([2]);
  });
});
