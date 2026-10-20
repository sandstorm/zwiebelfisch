// @vitest-environment jsdom
// Tests for commands.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandsHost, keyLabel, type Platform } from './commands';

function setup({ platform = 'win' as Platform } = {}) {
  const root = document.body.appendChild(document.createElement('div'));
  const inner = root.appendChild(document.createElement('div'));
  return { root, inner, commands: new CommandsHost(root, { platform }) };
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
    commands.declareKeybindings([{ key: 'Mod+Alt+KeyM', command: 'test.run' }]);
    const editor = vi.fn();
    inner.addEventListener('keydown', editor);
    const event = press(inner, { code: 'KeyM', altKey: true, ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('matches exactly the named modifiers: Mod is Cmd on the Mac, else Ctrl; AltGr (Ctrl+Alt) is not Alt', () => {
    const run = vi.fn();
    const other = setup();
    other.commands.registerCommand('test.run', run);
    other.commands.declareKeybindings([{ key: 'Alt+Digit1', command: 'test.run' }]);
    other.commands.declareKeybindings([{ key: 'Mod+KeyK', command: 'test.run' }]);
    expect(press(other.inner, { code: 'Digit1', altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(other.inner, { code: 'Digit1', altKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(other.inner, { code: 'KeyK', metaKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    press(other.inner, { code: 'Digit1', altKey: true });
    press(other.inner, { code: 'KeyK', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(2);

    const mac = setup({ platform: 'mac' });
    mac.commands.registerCommand('test.run', run);
    mac.commands.declareKeybindings([{ key: 'Mod+KeyK', command: 'test.run' }]);
    expect(press(mac.inner, { code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(false);
    press(mac.inner, { code: 'KeyK', metaKey: true });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("binds the declared keys, the Mac's on the Mac, and names a command's first key as people read it", () => {
    const declared = [
      { command: 'test.find', key: 'Mod+Shift+KeyF' },
      { command: 'test.files', key: 'Alt+Digit1', mac: 'Ctrl+Digit1' },
    ];
    const other = setup();
    other.commands.declareKeybindings(declared);
    other.commands.declareKeybindings([{ key: 'F3', command: 'test.find' }]);
    expect([other.commands.keybindingLabel('test.find'), other.commands.keybindingLabel('test.files'), other.commands.keybindingLabel('test.none')]).toEqual(['Ctrl+Shift+F', 'Alt+1', undefined]);
    const mac = setup({ platform: 'mac' });
    mac.commands.declareKeybindings(declared);
    expect([mac.commands.keybindingLabel('test.find'), mac.commands.keybindingLabel('test.files')]).toEqual(['⌘⇧F', '⌃1']);
    const run = vi.fn();
    mac.commands.registerCommand('test.files', run);
    press(mac.inner, { code: 'Digit1', altKey: true });
    press(mac.inner, { code: 'Digit1', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("binds a platform's own key, none where it is '', and passes a binding's argument", () => {
    const declared = [
      { command: 'test.files', key: 'Alt+Digit1', mac: 'Ctrl+Digit1', linux: '' },
      { command: 'test.open', key: 'Mod+Shift+KeyO', args: '/' },
    ];
    const run = vi.fn();
    const keysOn = (platform: Platform) => {
      const { commands } = setup({ platform });
      commands.declareKeybindings(declared);
      return commands.keybindingLabel('test.files');
    };
    expect([keysOn('mac'), keysOn('win'), keysOn('linux')]).toEqual(['⌃1', 'Alt+1', undefined]);
    const { inner, commands } = setup();
    commands.declareKeybindings(declared);
    commands.registerCommand('test.open', run);
    commands.declareKeybindings([{ key: 'Mod+KeyP', command: 'test.open' }]);
    press(inner, { code: 'KeyO', ctrlKey: true, shiftKey: true });
    press(inner, { code: 'KeyP', ctrlKey: true });
    expect(run.mock.calls).toEqual([['/'], []]);
  });

  it('labels keys of bindings and of the toolbar alike', () => {
    expect(['Mod+Alt+KeyM', 'Ctrl+Shift+Minus', 'Mod+B', 'Mod+Enter', 'Meta+Slash'].map((key) => keyLabel(key, true))).toEqual(['⌘⌥M', '⌃⇧-', '⌘B', '⌘Enter', '⌘/']);
    expect(['Mod+Alt+KeyM', 'Ctrl+Shift+Minus', 'Mod+B', 'Mod+Enter'].map((key) => keyLabel(key, false))).toEqual(['Ctrl+Alt+M', 'Ctrl+Shift+-', 'Ctrl+B', 'Ctrl+Enter']);
  });

  it('logs a bound command that fails, the key still taken', async () => {
    const { inner, commands } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    commands.registerCommand('test.fails', () => Promise.reject(new Error('nope')));
    commands.declareKeybindings([{ key: 'Mod+KeyK', command: 'test.fails' }]);
    expect(press(inner, { code: 'KeyK', ctrlKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Command test.fails failed:', expect.objectContaining({ message: 'nope' })));
  });

  it('leaves other keys to the editors, and bound keys once the command is gone', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    const command = commands.registerCommand('test.run', run);
    commands.declareKeybindings([{ key: 'Mod+Alt+KeyM', command: 'test.run' }]);
    press(inner, { code: 'KeyM', ctrlKey: true });
    press(inner, { code: 'KeyN', altKey: true, ctrlKey: true });
    command.dispose();
    expect(press(inner, { code: 'KeyM', altKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses unknown modifiers', () => {
    expect(() => setup().commands.declareKeybindings([{ key: 'Hyper+KeyM', command: 'test.run' }])).toThrow(/Unknown modifier Hyper/);
  });

  it('binds a modifier tapped twice (Shift Shift), named so, until the host is disposed', () => {
    const { inner, commands } = setup();
    const run = vi.fn();
    commands.registerCommand('test.search', run);
    commands.declareKeybindings([{ key: 'Shift Shift', command: 'test.search', args: 'all' }]);
    const tapShift = () => {
      for (const type of ['keydown', 'keyup', 'keydown', 'keyup']) inner.dispatchEvent(new KeyboardEvent(type, { key: 'Shift', shiftKey: type === 'keydown', bubbles: true }));
    };
    tapShift();
    expect(run.mock.calls).toEqual([['all']]);
    expect([commands.keybindingLabel('test.search'), keyLabel('Shift Shift', true)]).toEqual(['Shift Shift', '⇧ ⇧']);
    commands.dispose();
    tapShift();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('lists the declared commands that are registered now', () => {
    const { commands } = setup();
    commands.declareCommands([{ command: 'test.count', title: 'Count words', category: 'Test' }, { command: 'test.gone', title: 'Gone' }]);
    commands.registerCommand('test.count', () => {});
    commands.registerCommand('test.undeclared', () => {});
    expect(commands.getCommands()).toEqual([{ command: 'test.count', title: 'Count words', category: 'Test' }]);
  });
});
