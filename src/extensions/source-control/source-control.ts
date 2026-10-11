import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { SourceControl } from '../../hosts/scm/scm';
import css from './source-control.css?inline';
import { commit, commitTitle, resourceDecorations, SourceControlStatus } from './workbench/workbench';

/**
 * The UI over the registered source controls (`scm`), shown while there is at least one.
 *
 * - "Save to <label>…" in the tab bar (menu `editor/title`, "Saving to <label>…" while busy): the command
 *   `sourceControl.commit` asks for a commit message and commits.
 * - Their `statusBarCommands` at the start of the status bar (a click commits, too).
 * - Their `resourceStates` as file decorations.
 *
 * A source control (today the GitLab branch behind a collaboration room) registers itself with
 * `scm.registerSourceControl` and tells its outcomes itself. This extension only shows what is registered, so neither
 * knows the other. See docs/20_extensions/02_workbench-api.typ, "Source controls".
 */
export function sourceControl(): TypstExtension {
  return {
    id: 'source-control',
    activate(context) {
      const { commands, scm, window, workbench, subscriptions } = context;
      const followed = new Map<SourceControl, Disposable>();
      const changed = new EventEmitter<void>();
      const status = new SourceControlStatus(workbench.ownerDocument, (control) => void commit(context, control));
      let entry: Disposable | null = null;
      let statusItem: Disposable | null = null;
      const show = () => {
        const controls = scm.sourceControls;
        entry?.dispose();
        entry = controls.length === 0 ? null : workbench.registerMenuItem('editor/title', { command: 'sourceControl.commit', title: commitTitle(controls), group: 'sourceControl' });
        status.show(controls);
        const hasStatus = controls.some((control) => control.statusBarCommands?.length);
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
        workbench.registerStyleSheet(css),
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
