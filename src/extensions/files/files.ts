// The files extensions: the file panel (the project's files as a tree in the left side panel: new file / folder,
// upload, rename, delete, drag & drop, file decorations) and "← previous / next file →" around an included file.
// Entry of extensions/files/. See ARCHITECTURE.md, "File panel".
// Why one extension per concern: each is a controller over the workbench's contribution points (a side panel, an
// editor frame) and the project; the views (workbench/) and the pure tree model (model/) know nothing
// of the workbench, so the panel is tested without one.
import { Disposable } from '../../core/disposable/disposable';
import { neighbours } from '../../core/document-links/document-links';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './files.css?inline';
import { FileNavigation, FilePanel, icon } from './workbench/workbench';

/** When the file panel is open (the setting `files.panel`). */
type PanelMode = 'auto' | 'show' | 'hide';

/**
 * The file panel in a side panel: shows the project and the shown file, opens what is picked, asks for every
 * change through `Workbench.applyChange`, uploads files dropped on the widget, and shows the files' decorations
 * from every `FileDecorationProvider` (e.g. where collaborators are). The setting `files.panel` says when it is open.
 */
export function files(): TypstExtension {
  return {
    id: 'files',
    contributes: {
      configuration: {
        properties: {
          'files.panel': {
            type: 'string',
            enum: ['auto', 'show', 'hide'],
            default: 'auto',
            description:
              'When the file panel is open: auto while the project has more than one file, else collapsed to its rail button (until someone opens or closes it); show: open; hide: none at all (and dropped files are ignored).',
          },
        },
      },
    },
    activate({ project, workspace, workbench, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const mode = () => workspace.getConfiguration('files').get<PanelMode>('panel', 'auto');
      const side = workbench.registerSidePanel('files', { label: 'Files', icon: icon(workbench.ownerDocument, 'files') });
      const state = () => ({ paths: project.paths(), main: project.main, active: workbench.activeFile });
      const panel = new FilePanel(side.body, {
        onOpen: (path) => {
          workbench.open(path);
          side.dismiss();
        },
        onChange: (change) => workbench.applyChange(change),
        memory: workbench.remember('folders'),
        decorations: (path) => workbench.getFileDecorations(path),
      }, state());
      // shown on every open, which also follows every create / rename / delete
      // listening only while there is a panel: the widget shows its drop hint while anyone listens
      let drops: Disposable | null = null;
      const render = () => {
        const shown = mode();
        side.setAvailable(shown !== 'hide');
        side.setDefault(shown === 'show' || project.paths().length > 1);
        panel.render(state());
        if ((shown !== 'hide') === (drops !== null)) return;
        drops?.dispose();
        drops = shown === 'hide' ? null : workbench.onDidDropFiles((dropped) => void panel.upload(dropped));
      };
      render();
      subscriptions.push(
        side,
        new Disposable(() => panel.destroy()),
        new Disposable(() => drops?.dispose()),
        workbench.onDidShowFile(render),
        workbench.onDidChangeFileDecorations(() => panel.render(state())),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('files.panel')) render();
        }),
      );
    },
  };
}

/** "← previous file" / "next file →" above and below a file the main file includes, in its reading order. */
export function fileNavigation(): TypstExtension {
  return {
    id: 'file-navigation',
    activate({ project, workbench, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const navigation = new FileNavigation(workbench.ownerDocument, (path) => workbench.open(path));
      // recomputed on every open and every change: an #include may have been added, moved or removed
      const show = () => navigation.show(neighbours((path) => project.document(path)?.text, project.main, workbench.activeFile));
      subscriptions.push(workbench.registerEditorFrame(navigation), workbench.onDidShowFile(show), new Disposable(project.onChange(show)));
    },
  };
}
