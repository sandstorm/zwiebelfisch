// The source-control extension: the UI over the workbench's source controls: for each, "Save to <label>…" with a
// commit message and its status, next to the Visual / Source tabs. Entry of extensions/source-control/. See
// ARCHITECTURE.md, "GitLab-backed rooms".
// Why apart from what commits: a source control (the GitLab branch behind a collaboration room) registers itself with
// the workbench (`registerSourceControl`), and this extension only shows what is registered; neither knows the other.
import { Disposable } from '../../core/disposable/disposable';
import type { SourceControl, TypstExtension } from '../../hosts/workbench/workbench';
import { SourceControlView } from './workbench/workbench';

/** Shows every registered source control in the tab bar, for as long as it is registered. */
export function sourceControl(): TypstExtension {
  return {
    id: 'source-control',
    activate({ workbench, subscriptions }) {
      const shown = new Map<SourceControl, Disposable>();
      const show = (control: SourceControl) => {
        const item = workbench.ownerDocument.createElement('span');
        item.className = 'typst-editor__tab-actions';
        const view = new SourceControlView(item, control);
        return Disposable.from(workbench.registerTabBarItem(item), new Disposable(() => view.destroy()));
      };
      const update = () => {
        const registered = workbench.sourceControls;
        for (const [control, view] of shown) {
          if (registered.includes(control)) continue;
          view.dispose();
          shown.delete(control);
        }
        for (const control of registered) if (!shown.has(control)) shown.set(control, show(control));
      };
      update();
      subscriptions.push(
        workbench.onDidChangeSourceControls(update),
        new Disposable(() => {
          for (const view of shown.values()) view.dispose();
          shown.clear();
        }),
      );
    },
  };
}
