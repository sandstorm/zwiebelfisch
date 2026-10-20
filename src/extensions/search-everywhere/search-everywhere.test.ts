// @vitest-environment jsdom
// Tests for search-everywhere.ts in the composed hosts (Widget) (preview mocked: no worker in jsdom): its ways in (command, keys,
// double Shift, rail button) and its own groups, the declared commands and the settings.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import { Widget } from '../../editor/widget/widget';
import { searchEverywhere } from './search-everywhere';

vi.mock('../../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    onDidRender = () => new Disposable(() => {});
    dispose() {}
  },
}));

const path = ProjectPath.of;

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('searchEverywhere', () => {
  function setupSearch() {
    const host = document.body.appendChild(document.createElement('div'));
    const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n' });
    const widget = new Widget(host, project, { viewType: SOURCE_EDITOR, settings: { 'test.color': 'blue' } });
    const ran: string[] = [];
    widget.activate([
      searchEverywhere(),
      {
        id: 'test',
        contributes: {
          commands: [
            { command: 'test.count', title: 'Count words', category: 'Test' },
            { command: 'test.unregistered', title: 'Never registered' },
          ],
          keybindings: [{ command: 'test.count', key: 'Mod+Shift+KeyC' }],
          configuration: {
            properties: {
              'test.wrap': { type: 'boolean', default: false, description: 'Wrap lines.' },
              'test.color': { type: 'string', enum: ['red', 'blue'], default: 'red', description: 'The color.' },
              'test.name': { type: 'string', default: '', description: 'Free text: not offered.' },
            },
          },
        },
        activate: ({ commands, subscriptions }) => subscriptions.push(commands.registerCommand('test.count', () => ran.push('count'))),
      },
    ]);
    const field = () => host.querySelector<HTMLInputElement>('.zwf-quick-pick input')!;
    const options = () => [...host.querySelectorAll<HTMLElement>('[role=option]')];
    const enter = () => field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return { host, widget, ran, field, options, enter };
  }

  it('opens with the command (its argument the text to start with) and with the rail button', async () => {
    const { host, widget, field } = setupSearch();
    await widget.commands.executeCommand('workbench.action.searchEverywhere', '>');
    expect(field().value).toBe('>');
    host.querySelector<HTMLElement>('[data-command="workbench.action.searchEverywhere"]')!.click();
    expect(field().value).toBe('');
  });

  it('opens on Mod+P, with the files prefix on Mod+Shift+O and the commands prefix on Mod+Shift+A', () => {
    const { host, field } = setupSearch();
    const press = (code: string, shiftKey = false) => host.querySelector('.cm-content')!.dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, shiftKey, bubbles: true, cancelable: true }));
    expect(press('KeyP')).toBe(false);
    expect(field().value).toBe('');
    press('KeyO', true);
    expect(field().value).toBe('/');
    press('KeyA', true);
    expect(field().value).toBe('>');
  });

  it("puts its rail button among the left rail's panels by order 15: after Files (10), before Help (20)", () => {
    const { host, widget } = setupSearch();
    widget.window.registerSidePanel('help', { label: 'Help', icon: '<svg></svg>', order: 20 });
    widget.window.registerSidePanel('files', { label: 'Files', icon: '<svg></svg>', order: 10 });
    const left = host.querySelector<HTMLElement>('.zwf-editor__side--left .zwf-editor__rail')!;
    expect([...left.querySelectorAll<HTMLElement>('.zwf-editor__rail-button')].map((button) => button.dataset.testid ?? button.title)).toEqual([
      'zwf-panel-toggle-files',
      'Search everywhere (Shift Shift)',
      'zwf-panel-toggle-help',
    ]);
  });

  it('opens on double Shift in an editor, but not over an open input box', async () => {
    const { host, widget, field } = setupSearch();
    const shiftTwice = (target: Element) => {
      for (const type of ['keydown', 'keyup', 'keydown', 'keyup']) target.dispatchEvent(new KeyboardEvent(type, { key: 'Shift', shiftKey: type === 'keydown', bubbles: true }));
    };
    const rename = widget.window.showInputBox({ title: 'Rename' });
    const input = host.querySelector('.zwf-quick-input input')!;
    shiftTwice(input);
    expect(host.querySelector('[aria-label=Rename]')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await rename).toBeUndefined();
    shiftTwice(host.querySelector('.cm-content')!);
    expect(field()).not.toBeNull();
  });

  it('lists the declared commands that are registered, by category and title with their keys, and runs the one picked', async () => {
    const { widget, ran, options, enter } = setupSearch();
    await widget.commands.executeCommand('workbench.action.searchEverywhere', '>');
    expect(options().map((option) => option.textContent)).toEqual(['Test: Count words Ctrl+Shift+C']);
    expect(options()[0].querySelector('kbd')!.textContent).toBe('Ctrl+Shift+C');
    enter();
    expect(ran).toEqual(['count']);
  });

  it('switches a boolean setting, and sets an enum setting through a second quick pick', async () => {
    const { widget, options, enter } = setupSearch();
    await widget.commands.executeCommand('workbench.action.searchEverywhere', ':');
    // free text settings (workbench.rightSidePanel, test.name) are not offered
    expect(options().map((option) => option.querySelector('.zwf-quick-pick__label')!.textContent)).toEqual(['Workbench: Theme', 'Test: Wrap', 'Test: Color']);
    await widget.commands.executeCommand('workbench.action.searchEverywhere', ':wrap');
    enter();
    expect(widget.settings['test.wrap']).toBe(true);
    await widget.commands.executeCommand('workbench.action.searchEverywhere', ':color');
    enter();
    expect(options().map((option) => option.textContent)).toEqual(['red', 'blue current']);
    enter();
    await Promise.resolve();
    expect(widget.settings['test.color']).toBe('red');
  });
});
