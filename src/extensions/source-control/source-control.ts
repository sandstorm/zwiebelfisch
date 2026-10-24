import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { Extension } from '../../hosts/extension-host/extension-host';
import type { SourceControl } from '../../hosts/scm/scm';
import css from './source-control.css?inline';
import { commit, commitTitle, committable, resourceDecorations, SourceControlStatus } from './window/window';

/**
 * The UI over the registered source controls (`scm`), shown while there is at least one:
 * - "Save to <label>…" in the title bar (right, "Saving to <label>…" while busy), while one lets the user commit (has
 *   `commit`): the command `sourceControl.commit` asks for a commit message and commits
 * - their `statusBarItems` in the middle of the title bar, the save status (a click commits, too, where the user may)
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
      const save = window.ownerDocument.createElement('button');
      save.type = 'button';
      save.className = 'zwf-source-control__save';
      save.onclick = () => void commands.executeCommand('sourceControl.commit');
      const show = () => {
        const controls = scm.sourceControls;
        const savable = committable(controls);
        save.hidden = savable.length === 0;
        save.textContent = commitTitle(savable);
        status.show(controls);
        status.element.hidden = !controls.some((control) => control.statusBarItems?.length);
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
        window.registerTitleBarItem(save, { alignment: 'right', priority: 200 }),
        window.registerTitleBarItem(status.element, { alignment: 'center', priority: 100 }),
        window.registerFileDecorationProvider(resourceDecorations(scm, changed.event)),
        commands.registerCommand('sourceControl.commit', () => commit(context)),
        scm.onDidChangeSourceControls(update),
        new Disposable(() => {
          for (const subscription of followed.values()) subscription.dispose();
          followed.clear();
        }),
        changed,
      );
      update();
    },
  };
}
