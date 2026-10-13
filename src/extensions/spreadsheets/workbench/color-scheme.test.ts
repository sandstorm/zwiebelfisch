// @vitest-environment jsdom
// Tests for color-scheme.ts. jsdom resolves no var(): getComputedStyle answers a token `--zwf-x` as `rgb(<x>)`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followColorScheme } from './color-scheme';

let host: HTMLElement;
let container: HTMLElement;

beforeEach(() => {
  const computed = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const token = /^var\(--zwf-(.+)\)$/.exec((element as HTMLElement).style.color)?.[1];
    return token ? ({ color: `rgb(<${token}>)` } as CSSStyleDeclaration) : computed(element);
  });
  host = document.body.appendChild(document.createElement('div'));
  host.dataset.scheme = 'light';
  container = host.appendChild(document.createElement('div')).appendChild(document.createElement('div'));
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** The scheme changes as ColorScheme changes it; observers run after this. */
async function setScheme(scheme: string): Promise<void> {
  host.dataset.scheme = scheme;
  await Promise.resolve();
}

describe('followColorScheme', () => {
  it("leaves IronCalc's own colors in light mode", () => {
    followColorScheme(container, () => {});
    expect(container.getAttribute('style')).toBeNull();
  });

  it("sets the dark palette at once, from the widget's resolved tokens, and leaves no probe behind", () => {
    host.dataset.scheme = 'dark';
    followColorScheme(container, () => {});
    expect(container.style.getPropertyValue('--palette-common-white')).toBe('rgb(<bg>)');
    expect(container.style.getPropertyValue('--palette-sheet-default-text-color')).toBe('rgb(<text>)');
    expect(host.children).toHaveLength(1);
  });

  it('follows the scheme both ways and asks for a redraw each time', async () => {
    const redraw = vi.fn();
    followColorScheme(container, redraw);
    await setScheme('dark');
    expect(container.style.getPropertyValue('--palette-sheet-grid-color')).toBe('rgb(<divider>)');
    expect(redraw).toHaveBeenCalledTimes(1);
    await setScheme('light');
    expect(container.getAttribute('style')).toBe('');
    expect(redraw).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the scheme is set to what it was (ColorScheme does that on every OS change)', async () => {
    const redraw = vi.fn();
    followColorScheme(container, redraw);
    await setScheme('light');
    expect(redraw).not.toHaveBeenCalled();
  });

  it('keeps colors set on the container by others, and takes its own away when disposed', async () => {
    host.dataset.scheme = 'dark';
    container.style.setProperty('--palette-primary-main', 'red');
    const redraw = vi.fn();
    const scheme = followColorScheme(container, redraw);
    scheme.dispose();
    expect(container.style.getPropertyValue('--palette-common-white')).toBe('');
    expect(container.style.getPropertyValue('--palette-primary-main')).toBe('red');
    await setScheme('light');
    expect(redraw).not.toHaveBeenCalled();
  });

  it('does nothing outside a widget', () => {
    const alone = document.body.appendChild(document.createElement('div'));
    followColorScheme(alone, () => {}).dispose();
    expect(alone.getAttribute('style')).toBeNull();
  });
});
