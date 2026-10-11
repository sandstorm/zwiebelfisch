// @vitest-environment jsdom
// Tests for commands.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandsHost } from './commands';

function setup() {
  const root = document.body.appendChild(document.createElement('div'));
  const inner = root.appendChild(document.createElement('div'));
  return { root, inner, commands: new CommandsHost(root) };
}

function press(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => vi.restoreAllMocks());

describe('CommandsHost', () => {
  it('runs a registered command with its arguments, until it is disposed', async () => {
    const { commands } = setup();
    const registration = commands.registerCommand('test.add', (a: number, b: number) => a + b);
    await expect(commands.executeCommand<number>('test.add', 2, 3)).resolves.toBe(5);
    expect(() => commands.registerCommand('test.add', () => 0)).toThrow(/registered already/);
    registration.dispose();
    await expect(commands.executeCommand('test.add', 2, 3)).rejects.toThrow(/No command test.add/);
  });

  it('calls the handler synchronously, and resolves to what an async handler resolves to', async () => {
    const { commands } = setup();
    const calls: string[] = [];
    commands.registerCommand('test.async', async () => {
      calls.push('handler');
      return 'done';
    });
    const result = commands.executeCommand('test.async');
    calls.push('after execute');
    expect(calls).toEqual(['handler', 'after execute']);
    await expect(result).resolves.toBe('done');
  });

  it('rejects when the handler throws or rejects', async () => {
    const { commands } = setup();
    commands.registerCommand('test.throws', () => {
      throw new Error('broken');
    });
    commands.registerCommand('test.rejects', () => Promise.reject(new Error('later')));
    await expect(commands.executeCommand('test.throws')).rejects.toThrow('broken');
    await expect(commands.executeCommand('test.rejects')).rejects.toThrow('later');
  });

  it('runs a bound key anywhere inside, before (and instead of) the editors', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    commands.registerCommand('test.run', run);
    commands.registerKeybinding('Mod+Alt+KeyM', 'test.run');
    const editor = vi.fn();
    inner.addEventListener('keydown', editor);
    const event = press(inner, { code: 'KeyM', altKey: true, ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    press(inner, { code: 'KeyM', altKey: true, metaKey: true });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('logs a bound command that fails, the key still taken', async () => {
    const { inner, commands } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    commands.registerCommand('test.fails', () => Promise.reject(new Error('nope')));
    commands.registerKeybinding('Mod+KeyK', 'test.fails');
    expect(press(inner, { code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Command test.fails failed:', expect.objectContaining({ message: 'nope' })));
  });

  it('leaves other keys to the editors, and bound keys once the binding or the command is gone', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    const command = commands.registerCommand('test.run', run);
    const binding = commands.registerKeybinding('Mod+Alt+KeyM', 'test.run');
    press(inner, { code: 'KeyM', ctrlKey: true });
    press(inner, { code: 'KeyN', altKey: true, ctrlKey: true });
    binding.dispose();
    press(inner, { code: 'KeyM', altKey: true, ctrlKey: true });
    commands.registerKeybinding('Mod+Alt+KeyM', 'test.run');
    command.dispose();
    expect(press(inner, { code: 'KeyM', altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses unknown modifiers', () => {
    expect(() => setup().commands.registerKeybinding('Hyper+KeyM', 'test.run')).toThrow(/Unknown modifier Hyper/);
  });
});
