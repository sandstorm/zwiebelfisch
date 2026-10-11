// The key that opens search everywhere, anywhere in the widget. See SearchEverywhere in search.ts.
import { Disposable } from '../../../core/disposable/disposable';

/**
 * Calls `onDoubleShift` when Shift is pressed twice on `target` (in the capture phase, so before any editor inside):
 * the second press starting at most 300 ms after the first was released, neither together with another key or a mouse
 * button, nothing pressed in between; it fires when the second Shift is released (Shift held for a capital letter
 * never counts). `now` is the clock in milliseconds.
 */
export function listenForDoubleShift(target: HTMLElement, onDoubleShift: () => void, now: () => number = Date.now): Disposable {
  /** `down`: Shift pressed alone; `up`: released after such a press (at `releasedAt`); `again`: pressed a second time. */
  let state: 'idle' | 'down' | 'up' | 'again' = 'idle';
  let releasedAt = 0;
  const keydown = (event: KeyboardEvent) => {
    if (!isShiftAlone(event)) state = 'idle';
    else if (event.repeat) return;
    else state = state === 'up' && now() - releasedAt <= DOUBLE_SHIFT_INTERVAL ? 'again' : 'down';
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== 'Shift') return;
    if (state === 'again') onDoubleShift();
    state = state === 'down' ? 'up' : 'idle';
    releasedAt = now();
  };
  const reset = () => (state = 'idle');
  target.addEventListener('keydown', keydown, true);
  target.addEventListener('keyup', keyup, true);
  target.addEventListener('pointerdown', reset, true);
  return new Disposable(() => {
    target.removeEventListener('keydown', keydown, true);
    target.removeEventListener('keyup', keyup, true);
    target.removeEventListener('pointerdown', reset, true);
  });
}

/** The longest pause between releasing Shift the first time and pressing it again. */
export const DOUBLE_SHIFT_INTERVAL = 300;

/** A Shift press without Ctrl, Alt or Meta, not while composing text (an IME). */
function isShiftAlone(event: KeyboardEvent): boolean {
  return event.key === 'Shift' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing;
}
