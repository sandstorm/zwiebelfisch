// @vitest-environment jsdom
// Tests for color-scheme.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorScheme } from './color-scheme';

/** A stand-in for the OS setting (jsdom has no matchMedia): `flip()` reports a change. */
function fakeMedia() {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return { flip: () => listeners.forEach((listener) => listener()), count: () => listeners.size };
}

function host(color: string): HTMLElement {
  const element = document.body.appendChild(document.createElement('div'));
  element.style.color = color;
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('ColorScheme', () => {
  it('marks the widget dark where its text resolves light, light where it resolves dark', () => {
    fakeMedia();
    expect(new ColorScheme(host('rgb(230, 237, 243)')).host.dataset.scheme).toBe('dark');
    expect(new ColorScheme(host('rgb(31, 35, 40)')).host.dataset.scheme).toBe('light');
  });

  it('checks again when the OS scheme changes', () => {
    const media = fakeMedia();
    const element = host('rgb(31, 35, 40)');
    new ColorScheme(element);
    element.style.color = 'rgb(230, 237, 243)';
    media.flip();
    expect(element.dataset.scheme).toBe('dark');
  });

  it('takes its mark and its listener away when destroyed', () => {
    const media = fakeMedia();
    const scheme = new ColorScheme(host('rgb(230, 237, 243)'));
    scheme.destroy();
    expect(scheme.host.dataset.scheme).toBeUndefined();
    expect(media.count()).toBe(0);
  });
});
