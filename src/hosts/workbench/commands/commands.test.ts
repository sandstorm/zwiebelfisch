// @vitest-environment jsdom
// Tests for commands.ts.
import { describe, expect, it, vi } from 'vitest';
import { Commands } from './commands';

declare module '../workbench' {
  interface CommandRegistry {
    'test.add': (a: number, b: number) => number;
    'test.run': () => void;
  }
}

function setup() {
  const root = document.body.appendChild(document.createElement('div'));
  const inner = root.appendChild(document.createElement('div'));
  return { root, inner, commands: new Commands(root) };
}

function press(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('Commands', () => {
  it('runs a registered command with its arguments, until it is disposed', () => {
    const { commands } = setup();
    const registration = commands.register('test.add', (a, b) => a + b);
    expect(commands.execute('test.add', 2, 3)).toBe(5);
    expect(() => commands.register('test.add', () => 0)).toThrow(/registered already/);
    registration.dispose();
    expect(() => commands.execute('test.add', 2, 3)).toThrow(/No command test.add/);
  });

  it('runs a bound key anywhere inside, before (and instead of) the editors', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    commands.register('test.run', run);
    commands.bind('Mod+Alt+KeyM', 'test.run');
    const editor = vi.fn();
    inner.addEventListener('keydown', editor);
    const event = press(inner, { code: 'KeyM', altKey: true, ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    press(inner, { code: 'KeyM', altKey: true, metaKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('leaves other keys to the editors, and bound keys once the binding or the command is gone', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    const command = commands.register('test.run', run);
    const binding = commands.bind('Mod+Alt+KeyM', 'test.run');
    press(inner, { code: 'KeyM', ctrlKey: true });
    press(inner, { code: 'KeyN', altKey: true, ctrlKey: true });
    binding.dispose();
    press(inner, { code: 'KeyM', altKey: true, ctrlKey: true });
    commands.bind('Mod+Alt+KeyM', 'test.run');
    command.dispose();
    expect(press(inner, { code: 'KeyM', altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses unknown modifiers', () => {
    expect(() => setup().commands.bind('Hyper+KeyM', 'test.run')).toThrow(/Unknown modifier Hyper/);
  });
});
