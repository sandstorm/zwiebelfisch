// The versions extension: "Save version" with a commit message, and its outcome, in GitLab-backed rooms
// (VersionControls). Entry of extensions/versions/. See ARCHITECTURE.md, "GitLab-backed rooms".
// Why it is apart from collaboration: the collaboration chunk is loaded on demand, and only rooms backed by a GitLab
// branch have versions; this extension learns of them through the `collaboration` service and needs nothing else.
import { Disposable } from '../../core/disposable/disposable';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { VersionControls, type VersionControlsOptions } from './workbench/workbench';

/**
 * "Save version" next to the Visual / Source tabs, as `user`, once the collaboration session (the `collaboration`
 * service of an extension before it in the list) connects to a room backed by a GitLab branch.
 */
export function versions(options: VersionControlsOptions = {}): TypstExtension {
  return {
    id: 'versions',
    activate({ workbench, services, subscriptions }) {
      const session = services.get('collaboration');
      if (!session) return;
      subscriptions.push(
        session.onDidConnectVersions((connected) => {
          const toolbar = workbench.ownerDocument.createElement('span');
          toolbar.className = 'typst-editor__tab-actions';
          subscriptions.push(workbench.registerTabBarItem(toolbar));
          const controls = new VersionControls(toolbar, connected, options);
          subscriptions.push(new Disposable(() => controls.destroy()));
        }),
      );
    },
  };
}
