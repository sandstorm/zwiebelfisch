// The files extensions: the file panel (the project's files as a tree in the left side panel: new file / folder,
// upload, rename, delete, drag & drop, presence) and "← previous / next file →" around an included file.
// Entry of extensions/files/. See ARCHITECTURE.md, "File panel".
// Why one extension per concern: each is a controller over the workbench's contribution points (a side panel, an
// editor frame) and the project; the views (workbench/) and the pure tree model (model/) know nothing
// of the workbench, so the panel is tested without one.
import { Disposable } from '../../core/disposable/disposable';
import { neighbours } from '../../core/document-links/document-links';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { FileNavigation, FilePanel, icon } from './workbench/workbench';

export interface FilesOptions {
  /**
   * When the file panel is open: `auto` (default) while the project has more than one file, else collapsed to its
   * rail button (until someone opens or closes it); `show` open; `hide` none at all (and dropped files are ignored).
   */
  fileList?: 'auto' | 'show' | 'hide';
}

/**
 * The file panel in a side panel: shows the project and the shown file, opens what is picked, asks for every
 * change through `Workbench.applyChange`, uploads files dropped on the widget, and shows where collaborators are
 * (the `collaboration` service, when an extension before it in the list provides it).
 */
export function files(options: FilesOptions = {}): TypstExtension {
  return {
    id: 'files',
    activate({ project, workbench, services, subscriptions }) {
      const mode = options.fileList ?? 'auto';
      const side = workbench.registerSidePanel('files', { label: 'Files', icon: icon(workbench.ownerDocument, 'files') });
      const state = () => ({ paths: project.paths(), main: project.main, active: workbench.activeFile });
      const panel = new FilePanel(side.body, {
        onOpen: (path) => {
          workbench.open(path);
          side.dismiss();
        },
        onChange: (change) => workbench.applyChange(change),
        memory: workbench.remember('folders'),
      }, state());
      // shown on every open, which also follows every create / rename / delete
      const render = () => {
        side.setAvailable(mode !== 'hide');
        side.setDefault(mode === 'show' || project.paths().length > 1);
        panel.render(state());
      };
      subscriptions.push(side, new Disposable(() => panel.destroy()), workbench.onDidShowFile(render));
      if (mode !== 'hide') subscriptions.push(workbench.onDidDropFiles((dropped) => void panel.upload(dropped)));
      const collaboration = services.get('collaboration');
      if (collaboration) subscriptions.push(collaboration.onDidChangePresence((presences) => panel.showPresence(presences)));
    },
  };
}

/** "← previous file" / "next file →" above and below a file the main file includes, in its reading order. */
export function fileNavigation(): TypstExtension {
  return {
    id: 'file-navigation',
    activate({ project, workbench, subscriptions }) {
      const navigation = new FileNavigation(workbench.ownerDocument, (path) => workbench.open(path));
      // recomputed on every open and every change: an #include may have been added, moved or removed
      const show = () => navigation.show(neighbours((path) => project.document(path)?.text, project.main, workbench.activeFile));
      subscriptions.push(workbench.registerEditorFrame(navigation), workbench.onDidShowFile(show), new Disposable(project.onChange(show)));
    },
  };
}
