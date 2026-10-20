import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { SourceControl } from '../../hosts/scm/scm';
import css from './source-control.css?inline';
import { commit, commitTitle, resourceDecorations, SourceControlStatus } from './workbench/workbench';

/**
 * The UI over the registered source controls (`scm`), shown while there is at least one:
 * - "Save to <label>…" in the tab bar (menu `editor/title`, "Saving to <label>…" while busy): the command
 *   `sourceControl.commit` asks for a commit message and commits
 * - their `statusBarItems` at the start of the status bar (a click commits, too)
 * - their `resourceStates` as file decorations
 */
export function sourceControl(): Extension {
  return {
    id: 'source-control',
    activate(context) {
      const { commands, scm, window, subscriptions } = context;
      const followed = new Map<SourceControl, Disposable>();
      const changed = new EventEmitter<void>();
      const status = new SourceControlStatus(window.ownerDocument, (control) => void commit(context, control));
      let entry: Disposable | null = null;
      let statusItem: Disposable | null = null;
      const show = () => {
        const controls = scm.sourceControls;
        entry?.dispose();
        entry = controls.length === 0 ? null : window.registerMenuItem('editor/title', { command: 'sourceControl.commit', title: commitTitle(controls), group: 'sourceControl' });
        status.show(controls);
        const hasStatus = controls.some((control) => control.statusBarItems?.length);
        if (hasStatus && !statusItem) statusItem = window.registerStatusBarItem(status.element, { alignment: 'left', priority: 200 });
        if (!hasStatus && statusItem) {
          statusItem.dispose();
          statusItem = null;
        }
        changed.fire();
      };
      const update = () => {
        const registered = scm.sourceControls;
        for (const [control, subscription] of followed) {
          if (registered.includes(control)) continue;
          subscription.dispose();
          followed.delete(control);
        }
        for (const control of registered) {
          if (!followed.has(control)) followed.set(control, control.onDidChange(show));
        }
        show();
      };
      subscriptions.push(
        window.registerStyleSheet(css),
        window.registerFileDecorationProvider(resourceDecorations(scm, changed.event)),
        commands.registerCommand('sourceControl.commit', () => commit(context)),
        scm.onDidChangeSourceControls(update),
        new Disposable(() => {
          entry?.dispose();
          statusItem?.dispose();
          for (const subscription of followed.values()) subscription.dispose();
          followed.clear();
        }),
        changed,
      );
      update();
    },
  };
}
