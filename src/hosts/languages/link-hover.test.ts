// @vitest-environment jsdom
// Tests for link-hover.ts: the hint and the look of the link under the pointer, the same in every editor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hoverLink, type HoveredLink } from './link-hover';

const MOD = { ctrlKey: true, metaKey: true };

function setup() {
  const widget = document.body.appendChild(document.createElement('div'));
  widget.dataset.scheme = 'light';
  const element = widget.appendChild(document.createElement('a'));
  element.textContent = 'chapter';
  const hint = vi.fn(() => {
    const content = document.createElement('span');
    content.textContent = 'Go to Section · Intro (Ctrl+click or Alt+Enter)';
    return content;
  });
  const hovered: HoveredLink = { link: {}, element, followable: true, hint };
  /** The pointer moves over `element` (as `hovered`), or over no link. */
  const move = (over: HoveredLink | null = hovered, init: MouseEventInit = {}) => {
    const event = new MouseEvent('mousemove', { bubbles: true, ...init });
    element.dispatchEvent(event);
    hoverLink(event, over);
    return event;
  };
  const shown = () => widget.querySelector<HTMLElement>('.typst-link-hint');
  return { widget, element, hint, hovered, move, shown };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('hoverLink', () => {
  it('shows the hint after the hover delay, in the widget, as a tooltip describing the link', () => {
    const { element, hint, move, shown } = setup();
    move();
    vi.advanceTimersByTime(299);
    expect(shown()).toBeNull();
    move(); // the same link: the delay goes on
    vi.advanceTimersByTime(1);
    const tooltip = shown()!;
    expect(tooltip.getAttribute('role')).toBe('tooltip');
    expect(tooltip.textContent).toBe('Go to Section · Intro (Ctrl+click or Alt+Enter)');
    expect(element.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(hint).toHaveBeenCalledTimes(1);
  });

  it('places the hint fixed above the link', () => {
    const { element, move, shown } = setup();
    element.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 40, right: 90, width: 50, height: 20, x: 40, y: 100 }) as DOMRect;
    move();
    vi.advanceTimersByTime(300);
    expect([shown()!.style.top, shown()!.style.left]).toEqual(['100px', '40px']);
  });

  it('goes when the pointer leaves, unless it moves into the hint', () => {
    const { element, move, shown } = setup();
    move();
    vi.advanceTimersByTime(300);
    move(null);
    shown()!.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(1000);
    expect(shown()).not.toBeNull();
    shown()!.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);
    expect(shown()).toBeNull();
    expect(element.hasAttribute('aria-describedby')).toBe(false);
  });

  it('never shows when the pointer leaves before the delay', () => {
    const { move, shown } = setup();
    move();
    move(null);
    vi.advanceTimersByTime(1000);
    expect(shown()).toBeNull();
  });

  it('shows the link look while the modifier is held, only for a link that leads somewhere', () => {
    const { element, hovered, move } = setup();
    move(hovered, MOD);
    expect(element.classList.contains('typst-link--mod')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
    expect(element.classList.contains('typst-link--mod')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...MOD }));
    expect(element.classList.contains('typst-link--mod')).toBe(true);
    move({ ...hovered, link: {}, followable: false }, MOD);
    expect(element.classList.contains('typst-link--mod')).toBe(false);
  });

  it('puts the look and the description on `marked` (a CodeMirror editor) instead of the element', () => {
    const { widget, element, hovered, move, shown } = setup();
    move({ ...hovered, marked: widget }, MOD);
    vi.advanceTimersByTime(300);
    expect(widget.classList.contains('typst-link--mod')).toBe(true);
    expect(widget.getAttribute('aria-describedby')).toBe(shown()!.id);
    expect(element.classList.contains('typst-link--mod')).toBe(false);
  });

  it('ends at a click, a key that is no modifier, or when the element is gone', () => {
    const { element, move, shown } = setup();
    for (const end of [
      () => element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
      () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })),
      () => {
        element.remove();
        document.dispatchEvent(new MouseEvent('mousemove'));
      },
    ]) {
      move();
      vi.advanceTimersByTime(300);
      expect(shown()).not.toBeNull();
      end();
      expect(shown()).toBeNull();
    }
  });

  it('gives an event to the first link that takes it: an outer element does not end an inner link', () => {
    const { hovered, move, shown } = setup();
    const event = move();
    hoverLink(event, null); // the editor around it sees the same event
    vi.advanceTimersByTime(300);
    expect(shown()).not.toBeNull();
    expect(hovered.hint).toHaveBeenCalled();
  });
});
