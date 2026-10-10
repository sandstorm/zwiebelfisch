// @vitest-environment jsdom
// Tests for workbench.ts (commit, tellStatus) and the extension's wiring (../source-control.ts) over a fake workbench.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ExtensionContext, MenuItem, SourceControl, SourceControlState } from '../../../hosts/workbench/workbench';
import { sourceControl as sourceControlExtension } from '../source-control';
import { commit, tellStatus, type SourceControlUi } from './workbench';

function control(id = 'gitlab', label = 'GitLab') {
  const committed: string[] = [];
  const changed = new EventEmitter<void>();
  const sourceControl: SourceControl & { state: SourceControlState } = {
    id,
    label,
    defaultCommitMessage: 'Edit via Typst editor',
    state: { busy: false, status: null },
    onDidChange: changed.event,
    commit: (message) => {
      committed.push(message);
      update({ busy: true, status: null });
    },
  };
  const update = (state: SourceControlState) => {
    sourceControl.state = state;
    changed.fire();
  };
  return { sourceControl, committed, update };
}

function ui(controls: SourceControl[], answers: { input?: string; pick?: number } = {}) {
  const told: string[] = [];
  const asked: unknown[] = [];
  const fake: SourceControlUi = {
    get sourceControls() {
      return controls;
    },
    showInputBox: async (options) => (asked.push(options), answers.input),
    showQuickPick: (async (items: readonly unknown[]) => items[answers.pick ?? -1]) as SourceControlUi['showQuickPick'],
    showInformationMessage: async (message: string) => (told.push(`info: ${message}`), undefined),
    showWarningMessage: async (message: string) => (told.push(`warning: ${message}`), undefined),
    showErrorMessage: async (message: string) => (told.push(`error: ${message}`), undefined),
  };
  return { fake, told, asked };
}

describe('commit', () => {
  it('asks for the commit message (the default offered) and commits it', async () => {
    const { sourceControl, committed } = control();
    const { fake, asked } = ui([sourceControl], { input: ' Fix the intro ' });
    await commit(fake);
    expect(asked).toEqual([expect.objectContaining({ title: 'Save to GitLab', prompt: 'Commit message', value: 'Edit via Typst editor' })]);
    expect(committed).toEqual(['Fix the intro']);
  });

  it('commits nothing when cancelled, and only says so while a commit is under way', async () => {
    const { sourceControl, committed, update } = control();
    await commit(ui([sourceControl]).fake);
    update({ busy: true, status: null });
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

describe('tellStatus', () => {
  it('tells each new status once, as a message of its severity', () => {
    const { sourceControl, update } = control();
    const { fake, told } = ui([sourceControl]);
    const subscription = tellStatus(fake, sourceControl);
    const saved = { message: 'Saved version 01234567 (Ann)', severity: 'info' } as const;
    update({ busy: false, status: saved });
    update({ busy: false, status: saved });
    update({ busy: false, status: { message: 'Saving failed: no token', severity: 'error' } });
    subscription.dispose();
    update({ busy: false, status: { message: 'Merged new changes from GitLab', severity: 'info' } });
    expect(told).toEqual(['info: Saved version 01234567 (Ann)', 'error: Saving failed: no token']);
  });
});

describe('sourceControl extension', () => {
  it('shows "Save to <label>…" in the tab bar while a source control is registered, and commits from it', async () => {
    const { sourceControl, committed, update } = control();
    const controls: SourceControl[] = [];
    const changed = new EventEmitter<void>();
    const menu: MenuItem[] = [];
    const commands = new Map<string, () => unknown>();
    const { fake, told } = ui(controls, { input: 'Saved' });
    const workbench = {
      ...fake,
      get sourceControls() {
        return controls;
      },
      onDidChangeSourceControls: changed.event,
      registerCommand: (id: string, handler: () => unknown) => (commands.set(id, handler), new Disposable(() => commands.delete(id))),
      registerMenuItem: vi.fn((_menuId: string, item: MenuItem) => {
        menu.push(item);
        return new Disposable(() => menu.splice(menu.indexOf(item), 1));
      }),
    };
    const subscriptions: { dispose(): unknown }[] = [];
    sourceControlExtension().activate({ workbench, subscriptions } as unknown as ExtensionContext);
    expect(menu).toEqual([]);
    controls.push(sourceControl);
    changed.fire();
    expect(workbench.registerMenuItem).toHaveBeenLastCalledWith('editor/title', expect.objectContaining({ command: 'sourceControl.commit' }));
    expect(menu.map((item) => item.title)).toEqual(['Save to GitLab…']);
    await commands.get('sourceControl.commit')!();
    expect(committed).toEqual(['Saved']);
    expect(menu.map((item) => item.title)).toEqual(['Saving to GitLab…']);
    update({ busy: false, status: { message: 'No changes to save', severity: 'info' } });
    expect(told).toEqual(['info: No changes to save']);
    expect(menu.map((item) => item.title)).toEqual(['Save to GitLab…']);
    controls.pop();
    changed.fire();
    expect(menu).toEqual([]);
    for (const subscription of subscriptions.reverse()) subscription.dispose();
    expect(commands.size).toBe(0);
  });
});
