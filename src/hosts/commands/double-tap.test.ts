// @vitest-environment jsdom
// Tests for double-tap.ts: what counts as pressing a modifier twice.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listenForDoubleTap } from './double-tap';

afterEach(() => document.body.replaceChildren());

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  // an editor inside that keeps its keys to itself (as CodeMirror, ProseMirror or IronCalc may)
  const editor = host.appendChild(document.createElement('div'));
  editor.addEventListener('keydown', (event) => event.stopPropagation());
  editor.addEventListener('keyup', (event) => event.stopPropagation());
  let time = 0;
  const onDoubleShift = vi.fn();
  listenForDoubleTap(host, 'Shift', onDoubleShift, () => time);
  const send = (type: 'keydown' | 'keyup', key: string, init: KeyboardEventInit = {}) =>
    editor.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...init }));
  /** Shift down and up, `wait` ms after the previous step. */
  const tap = (wait = 0, init: KeyboardEventInit = {}) => {
    time += wait;
    send('keydown', 'Shift', { shiftKey: true, ...init });
    time += 50;
    send('keyup', 'Shift', init);
  };
  return { onDoubleShift, send, tap, wait: (ms: number) => (time += ms) };
}

describe('listenForDoubleTap', () => {
  it('fires when Shift is tapped twice quickly, inside an editor too, on the second release', () => {
    const { onDoubleShift, tap, send } = setup();
    tap();
    send('keydown', 'Shift', { shiftKey: true });
    expect(onDoubleShift).not.toHaveBeenCalled();
    send('keyup', 'Shift');
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('needs the second press within 300 ms of the first release', () => {
    const { onDoubleShift, tap } = setup();
    tap();
    tap(300);
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
    tap(400);
    tap(301);
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('does not count Shift held for a capital letter, nor a key pressed in between', () => {
    const { onDoubleShift, tap, send } = setup();
    tap();
    send('keydown', 'Shift', { shiftKey: true });
    send('keydown', 'A', { shiftKey: true });
    send('keyup', 'Shift');
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap();
    send('keydown', 'a');
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
  });

  it('does not count Shift with another modifier, a mouse press in between, or a held key repeating', () => {
    const { onDoubleShift, tap, send } = setup();
    tap(0, { ctrlKey: true });
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap(1000);
    document.body.firstElementChild!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    tap();
    expect(onDoubleShift).not.toHaveBeenCalled();
    tap(1000);
    send('keydown', 'Shift', { shiftKey: true });
    send('keydown', 'Shift', { shiftKey: true, repeat: true });
    send('keyup', 'Shift');
    expect(onDoubleShift).toHaveBeenCalledTimes(1);
  });

  it('does not count presses in a text field (an input box), and counts another modifier alone', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const field = host.appendChild(document.createElement('input'));
    const onAlt = vi.fn();
    listenForDoubleTap(host, 'Alt', onAlt);
    const tapOn = (target: Element, key: string, init: KeyboardEventInit) => {
      for (const type of ['keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, ...(type === 'keydown' ? init : {}) }));
    };
    tapOn(field, 'Alt', { altKey: true });
    tapOn(field, 'Alt', { altKey: true });
    expect(onAlt).not.toHaveBeenCalled();
    tapOn(host, 'Alt', { altKey: true });
    tapOn(host, 'Alt', { altKey: true });
    expect(onAlt).toHaveBeenCalledTimes(1);
  });
});
