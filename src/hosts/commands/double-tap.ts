// A key binding of a modifier pressed twice (`Shift Shift`). See CommandsHost in commands-impl.ts.
import { Disposable } from '../../core/disposable/disposable';

/**
 * Calls `onDoubleTap` when `modifier` (a `KeyboardEvent.key`: `Shift`, `Control`, `Alt`, `Meta`) is pressed twice on
 * `target` (in the capture phase, so before any editor inside): the second press starting at most 300 ms after the
 * first was released, neither together with another key or a mouse button, nothing pressed in between; it fires when
 * the second press is released (Shift held for a capital letter never counts). Not in a text field (`input`,
 * `textarea`, e.g. an open input box): what is typed there stays. `now` is the clock in milliseconds.
 */
export function listenForDoubleTap(target: HTMLElement, modifier: string, onDoubleTap: () => void, now: () => number = Date.now): Disposable {
  /** `down`: pressed alone; `up`: released after such a press (at `releasedAt`); `again`: pressed a second time. */
  let state: 'idle' | 'down' | 'up' | 'again' = 'idle';
  let releasedAt = 0;
  const keydown = (event: KeyboardEvent) => {
    if (!isAlone(event, modifier) || inTextField(event)) state = 'idle';
    else if (event.repeat) return;
    else state = state === 'up' && now() - releasedAt <= DOUBLE_TAP_INTERVAL ? 'again' : 'down';
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== modifier) return;
    if (state === 'again') onDoubleTap();
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

/** The longest pause between releasing the modifier the first time and pressing it again. */
export const DOUBLE_TAP_INTERVAL = 300;

/** A press of `modifier` without any other modifier, not while composing text (an IME). */
function isAlone(event: KeyboardEvent, modifier: string): boolean {
  const others = { Shift: event.shiftKey, Control: event.ctrlKey, Alt: event.altKey, Meta: event.metaKey };
  return event.key === modifier && !event.isComposing && Object.entries(others).every(([name, pressed]) => name === modifier || !pressed);
}

function inTextField(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  return target instanceof Element && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
}
