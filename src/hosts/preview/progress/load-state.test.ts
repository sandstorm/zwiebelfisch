// Tests for load-state.ts.
import { describe, expect, it } from 'vitest';
import { LoadState } from './load-state';

describe('LoadState', () => {
  it('shows the engine download in MB, then "Compiling…" until a compile answered, then nothing', () => {
    const state = new LoadState();
    expect(state.current()).toEqual({ kind: 'engine', title: 'Loading the Typst compiler…', detail: null, fraction: null });
    state.apply({ kind: 'engine', loaded: 3_100_000, total: 6_600_000 });
    expect(state.current()).toEqual({ kind: 'engine', title: 'Loading the Typst compiler…', detail: '3.1 / 6.6 MB', fraction: 3.1 / 6.6 });
    state.apply({ kind: 'ready' });
    expect(state.current()?.title).toBe('Compiling…');
    state.compiled();
    expect(state.current()).toBeNull();
  });

  it('shows the bytes alone when the total is unknown', () => {
    const state = new LoadState();
    state.apply({ kind: 'engine', loaded: 12_345_678, total: null });
    expect(state.current()).toMatchObject({ detail: '12.3 MB', fraction: null });
  });

  it('names the packages downloading, before fonts and the first compile', () => {
    const state = new LoadState();
    state.apply({ kind: 'ready' });
    state.apply({ kind: 'font', name: 'NewCMMath-Book.otf' });
    expect(state.current()?.title).toBe('Loading fonts…');
    state.apply({ kind: 'packages', specs: ['@preview/merman:0.4.0', '@preview/cetz:0.3.1'] });
    expect(state.current()).toMatchObject({ kind: 'packages', title: 'Downloading @preview/merman 0.4.0, @preview/cetz 0.3.1…' });
    state.apply({ kind: 'packages', specs: [] });
    state.apply({ kind: 'font', name: null });
    state.compiled();
    expect(state.current()).toBeNull();
    state.apply({ kind: 'packages', specs: ['@preview/merman:0.4.0'] });
    expect(state.current()?.kind).toBe('packages');
  });

  it('a failed engine wins over everything, with the reason', () => {
    const state = new LoadState();
    state.apply({ kind: 'failed', message: '/engine.wasm: HTTP 404' });
    state.apply({ kind: 'engine', loaded: 5, total: 10 });
    expect(state.current()).toEqual({ kind: 'failed', title: 'The Typst compiler could not be loaded.', detail: '/engine.wasm: HTTP 404', fraction: null });
  });
});
