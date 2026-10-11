// The source-control extension: the UI over the registered source controls (`scm`): "Save to <label>…" in the tab bar
// (menu `editor/title`), which asks for a commit message and commits, and their outcomes and news as messages.
// Entry of extensions/source-control/. See ARCHITECTURE.md, "GitLab-backed rooms".
// Why apart from what commits: a source control (the GitLab branch behind a collaboration room) registers itself
// (`scm.registerSourceControl`), and this extension only shows what is registered; neither knows the other.
import { Disposable } from '../../core/disposable/disposable';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import type { SourceControl } from '../../hosts/scm/scm';
import { commit, commitTitle, tellStatus } from './workbench/workbench';

/**
 * While a source control is registered: the command `sourceControl.commit` as "Save to <label>…" in the tab bar, and
 * every source control's outcomes and news as messages.
 */
export function sourceControl(): TypstExtension {
  return {
    id: 'source-control',
    activate(context) {
      const { commands, window, scm, workbench, subscriptions } = context;
      const followed = new Map<SourceControl, Disposable>();
      let entry: Disposable | null = null;
      const showEntry = () => {
        entry?.dispose();
        const controls = scm.sourceControls;
        entry = controls.length === 0 ? null : workbench.registerMenuItem('editor/title', { command: 'sourceControl.commit', title: commitTitle(controls), group: 'sourceControl' });
      };
      const update = () => {
        const registered = scm.sourceControls;
        for (const [control, subscription] of followed) {
          if (registered.includes(control)) continue;
          subscription.dispose();
          followed.delete(control);
        }
        for (const control of registered) {
          if (!followed.has(control)) followed.set(control, Disposable.from(tellStatus(window, control), control.onDidChange(showEntry)));
        }
        showEntry();
      };
      update();
      subscriptions.push(
        commands.registerCommand('sourceControl.commit', () => commit(context)),
        scm.onDidChangeSourceControls(update),
        new Disposable(() => {
          entry?.dispose();
          for (const subscription of followed.values()) subscription.dispose();
          followed.clear();
        }),
      );
    },
  };
}
