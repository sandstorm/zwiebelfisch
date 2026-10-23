// @vitest-environment jsdom
// Tests for widget.ts (commit, status bar entries, file decorations) and the extension's wiring (../source-control.ts)
// over a fake widget.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { ExtensionContext } from '../../../hosts/extension-host/extension-host';
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlResourceState, SourceControlStatusBarItem } from '../../../hosts/scm/scm';
import type { FileDecorationProvider } from '../../../hosts/window/window';
import { sourceControl as sourceControlExtension } from '../source-control';
import { commit, type SourceControlUi } from './window';

function control(id = 'gitlab', label = 'GitLab') {
  const committed: string[] = [];
  const changed = new EventEmitter<void>();
  const sourceControl: SourceControl & {
    busy: boolean;
    resourceStates: SourceControlResourceState[];
    statusBarItems: SourceControlStatusBarItem[];
  } = {
    id,
    label,
    defaultCommitMessage: 'Edit via Zwiebelfisch',
    busy: false,
    resourceStates: [],
    statusBarItems: [],
    onDidChange: changed.event,
    commit: (message) => {
      committed.push(message);
      update(true);
    },
  };
  const update = (busy: boolean) => {
    sourceControl.busy = busy;
    changed.fire();
  };
  const show = (shown: Pick<typeof sourceControl, 'resourceStates' | 'statusBarItems'>) => {
    Object.assign(sourceControl, shown);
    changed.fire();
  };
  return { sourceControl, committed, update, show };
}

function ui(controls: SourceControl[], answers: { input?: string; pick?: number } = {}) {
  const told: string[] = [];
  const asked: unknown[] = [];
  const fake: SourceControlUi = {
    scm: {
      get sourceControls() {
        return controls;
      },
    },
    window: {
      showInputBox: async (options) => (asked.push(options), answers.input),
      showQuickPick: (async (items: readonly unknown[]) => items[answers.pick ?? -1]) as SourceControlUi['window']['showQuickPick'],
      showInformationMessage: async (message: string) => (told.push(`info: ${message}`), undefined),
    },
  };
  return { fake, told, asked };
}

describe('commit', () => {
  it('asks for the commit message (the default offered) and commits it', async () => {
    const { sourceControl, committed } = control();
    const { fake, asked } = ui([sourceControl], { input: ' Fix the intro ' });
    await commit(fake);
    expect(asked).toEqual([expect.objectContaining({ title: 'Save to GitLab', prompt: 'Commit message', value: 'Edit via Zwiebelfisch' })]);
    expect(committed).toEqual(['Fix the intro']);
  });

  it('commits nothing when cancelled, and only says so while a commit is under way', async () => {
    const { sourceControl, committed, update } = control();
    await commit(ui([sourceControl]).fake);
    update(true);
    const busy = ui([sourceControl], { input: 'x' });
    await commit(busy.fake);
    expect(committed).toEqual([]);
    expect(busy.told).toEqual(['info: Saving to GitLab is under way.']);
  });

  it('lets the user pick one of several source controls', async () => {
    const first = control('a', 'A');
    const second = control('b', 'B');
    await commit(ui([first.sourceControl, second.sourceControl], { pick: 1, input: 'msg' }).fake);
    expect([first.committed, second.committed]).toEqual([[], ['msg']]);
  });
});

/** The extension activated over a fake window with `controls` registered (`changed` fires when they change). */
function activate(controls: SourceControl[], answers: { input?: string } = {}) {
  const changed = new EventEmitter<void>();
  const menu: MenuItem[] = [];
  const statusBar: HTMLElement[] = [];
  const decorations: FileDecorationProvider[] = [];
  const commands = new Map<string, () => unknown>();
  const { fake, told } = ui(controls, answers);
  const window = {
    ...fake.window,
    ownerDocument: document,
    registerStyleSheet: () => new Disposable(() => {}),
    registerMenuItem: vi.fn((_menuId: string, item: MenuItem) => {
      menu.push(item);
      return new Disposable(() => menu.splice(menu.indexOf(item), 1));
    }),
    registerStatusBarItem: (element: HTMLElement) => (statusBar.push(element), new Disposable(() => statusBar.splice(statusBar.indexOf(element), 1))),
    registerFileDecorationProvider: (provider: FileDecorationProvider) => (decorations.push(provider), new Disposable(() => decorations.splice(decorations.indexOf(provider), 1))),
  };
  const scm = {
    get sourceControls() {
      return controls;
    },
    onDidChangeSourceControls: changed.event,
  };
  const registry = { registerCommand: (id: string, handler: () => unknown) => (commands.set(id, handler), new Disposable(() => commands.delete(id))) };
  const subscriptions: { dispose(): unknown }[] = [];
  sourceControlExtension().activate({ commands: registry, window, scm, subscriptions } as unknown as ExtensionContext);
  const dispose = () => {
    for (const subscription of subscriptions.reverse()) subscription.dispose();
  };
  return { changed, menu, statusBar, decorations, commands, told, window, dispose };
}

describe('sourceControl extension', () => {
  it('shows "Save to <label>…" in the tab bar while a source control is registered, and commits from it', async () => {
    const { sourceControl, committed, update } = control();
    const controls: SourceControl[] = [];
    const { changed, menu, commands, told, window, dispose } = activate(controls, { input: 'Saved' });
    expect(menu).toEqual([]);
    controls.push(sourceControl);
    changed.fire();
    expect(window.registerMenuItem).toHaveBeenLastCalledWith('window/editorTitle', expect.objectContaining({ command: 'sourceControl.commit' }));
    expect(menu.map((item) => item.title)).toEqual(['Save to GitLab…']);
    await commands.get('sourceControl.commit')!();
    expect(committed).toEqual(['Saved']);
    expect(menu.map((item) => item.title)).toEqual(['Saving to GitLab…']);
    update(false);
    expect(told).toEqual([]);
    expect(menu.map((item) => item.title)).toEqual(['Save to GitLab…']);
    controls.pop();
    changed.fire();
    expect(menu).toEqual([]);
    dispose();
    expect(commands.size).toBe(0);
  });

  it('shows the status bar entries while there are any; a click commits to that source control', async () => {
    const { sourceControl, committed, show } = control();
    const { statusBar, dispose } = activate([sourceControl], { input: 'From the status bar' });
    expect(statusBar).toEqual([]);
    show({ resourceStates: [], statusBarItems: [{ title: 'Not in GitLab: 1 file · 3 min (Ann)', tooltip: 'M main.typ' }] });
    expect(statusBar).toHaveLength(1);
    const button = () => statusBar[0].querySelector('button')!;
    expect([button().textContent, button().title]).toEqual(['Not in GitLab: 1 file · 3 min (Ann)', 'M main.typ']);
    const first = button();
    show({ resourceStates: [], statusBarItems: [{ title: 'Saved · 01234567' }] });
    expect(button()).toBe(first);
    expect(button().textContent).toBe('Saved · 01234567');
    expect(button().classList.contains('zwf-source-control__entry--warning')).toBe(false);
    show({ resourceStates: [], statusBarItems: [{ title: 'Conflict with GitLab: main.typ', backgroundColor: 'warning' }, { title: 'Saved · 01234567' }] });
    expect([...statusBar[0].children].map((entry) => [entry.textContent, entry.classList.contains('zwf-source-control__entry--warning')])).toEqual([
      ['Conflict with GitLab: main.typ', true],
      ['Saved · 01234567', false],
    ]);
    button().click();
    await vi.waitFor(() => expect(committed).toEqual(['From the status bar']));
    show({ resourceStates: [], statusBarItems: [] });
    expect(statusBar).toEqual([]);
    dispose();
  });

  it('decorates the files of the resource states, also on closed folders, and tells when they change', () => {
    const { sourceControl, show } = control();
    const { decorations, dispose } = activate([sourceControl]);
    const [provider] = decorations;
    let told = 0;
    provider.onDidChangeFileDecorations(() => told++);
    const path = ProjectPath.of('/chapters/intro.typ');
    show({ resourceStates: [{ path, decorations: { badge: 'M', tooltip: 'Changed', color: '#b58900' } }, { path: ProjectPath.of('/plain.typ') }], statusBarItems: [] });
    expect(told).toBe(1);
    expect(provider.provideFileDecoration(path)).toEqual([{ badge: 'M', tooltip: 'Changed', color: '#b58900', propagate: true }]);
    expect(provider.provideFileDecoration(ProjectPath.of('/plain.typ'))).toEqual([]);
    dispose();
    expect(decorations).toEqual([]);
  });
});

describe('a source control the user may not commit to (a guest\'s)', () => {
  it('has no "Save to…" entry, and its status bar entries commit nothing', async () => {
    const { sourceControl, show } = control();
    const viewOnly: SourceControl = { ...sourceControl, commit: undefined, onDidChange: sourceControl.onDidChange };
    Object.defineProperty(viewOnly, 'statusBarItems', { get: () => sourceControl.statusBarItems });
    const { menu, statusBar, commands, dispose } = activate([viewOnly], { input: 'x' });
    show({ resourceStates: [], statusBarItems: [{ title: 'Not in GitLab: 1 file · 3 min (Jane (guest))' }] });
    expect(menu).toEqual([]);
    expect(statusBar).toHaveLength(1);
    statusBar[0].querySelector('button')!.click();
    await commands.get('sourceControl.commit')!();
    const asked = ui([viewOnly], { input: 'x' });
    await commit(asked.fake, viewOnly);
    expect(asked.asked).toEqual([]);
    dispose();
  });
});
