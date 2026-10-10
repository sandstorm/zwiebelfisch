// The files extensions: the file panel (the project's files as a tree in the left side panel: new file / folder,
// upload, rename, delete as commands in its menus, drag & drop, file decorations) and "← previous / next file →"
// around an included file. Entry of extensions/files/. See ARCHITECTURE.md, "File panel".
// Why one extension per concern: each is a controller over the workbench's contribution points (a side panel, an
// editor frame, commands, menus) and the project; the views (workbench/) and the pure tree model (model/) get what
// they need of the workbench as options, so the panel is tested without one.
import { Disposable } from '../../core/disposable/disposable';
import { neighbours } from '../../core/document-links/document-links';
import type { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './files.css?inline';
import { CONTEXT_MENU, FileNavigation, FilePanel, icon, NEW_FILE_MENU } from './workbench/workbench';

export interface FilesOptions {
  /**
   * When the file panel is open: `auto` (default) while the project has more than one file, else collapsed to its
   * rail button (until someone opens or closes it); `show` open; `hide` none at all (and dropped files are ignored).
   */
  fileList?: 'auto' | 'show' | 'hide';
}

declare module '../../hosts/workbench/workbench' {
  interface CommandRegistry {
    /** Asks for a name and creates a `.typ` file in the folder of `resource` (default: the panel's focused row; the files extension). */
    'files.newFile': (resource?: ProjectPath) => Promise<void>;
    /** Asks for a name and makes a folder in the folder of `resource` (the files extension). */
    'files.newFolder': (resource?: ProjectPath) => Promise<void>;
    /** Lets the user pick files to upload into the folder of `resource` (the files extension). */
    'files.upload': (resource?: ProjectPath) => void;
    /** Asks for a new name of the file or folder `resource` (the files extension). */
    'files.rename': (resource?: ProjectPath) => Promise<void>;
    /** Deletes the file or folder `resource` once the user confirms (the files extension). */
    'files.delete': (resource?: ProjectPath) => Promise<void>;
  }
}

/** The panel's own entries: in "New" (`file/newFile`) and in a row's context menu (`explorer/context`). */
const NEW_ENTRIES = [
  { command: 'files.newFile', title: 'New file…', order: 10 },
  { command: 'files.newFolder', title: 'New folder…', order: 20 },
  { command: 'files.upload', title: 'Upload files…', order: 30 },
] as const;
const CHANGE_ENTRIES = [
  { command: 'files.rename', title: 'Rename…', order: 10 },
  { command: 'files.delete', title: 'Delete', order: 20 },
] as const;

/**
 * The file panel in a side panel: shows the project and the shown file, opens what is picked, asks for every
 * change through `Workbench.applyChange`, uploads files dropped on the widget, and shows the files' decorations
 * from every `FileDecorationProvider` (e.g. where collaborators are). Its operations are commands (`files.newFile`,
 * `files.newFolder`, `files.upload`, `files.rename`, `files.delete`, each on a row), offered in two menus any
 * extension may add to: `file/newFile` ("New" in the panel's header) and `explorer/context` (a row's context menu;
 * context: `resource`, `resourceKind` 'file' | 'folder', `resourceIsMain`; the command gets the row).
 */
export function files(options: FilesOptions = {}): TypstExtension {
  return {
    id: 'files',
    activate({ project, workbench, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const mode = options.fileList ?? 'auto';
      const side = workbench.registerSidePanel('files', { label: 'Files', icon: icon(workbench.ownerDocument, 'files') });
      const state = () => ({ paths: project.paths(), main: project.main, active: workbench.activeFile });
      const panel = new FilePanel(side.body, {
        onOpen: (path) => {
          workbench.open(path);
          side.dismiss();
        },
        onChange: (change) => workbench.applyChange(change),
        prompts: workbench,
        menus: {
          items: (menuId, context) => workbench.getMenuItems(menuId, context),
          // menu entries name their command by id (any extension's); the row is its argument
          run: (command, resource) => void (workbench.executeCommand as (id: string, resource: ProjectPath) => unknown).call(workbench, command, resource),
        },
        memory: workbench.remember('folders'),
        decorations: (path) => workbench.getFileDecorations(path),
      }, state());
      // shown on every open, which also follows every create / rename / delete
      const render = () => {
        side.setAvailable(mode !== 'hide');
        side.setDefault(mode === 'show' || project.paths().length > 1);
        panel.render(state());
      };
      subscriptions.push(
        side,
        new Disposable(() => panel.destroy()),
        workbench.registerCommand('files.newFile', (resource) => panel.newFile(resource)),
        workbench.registerCommand('files.newFolder', (resource) => panel.newFolder(resource)),
        workbench.registerCommand('files.upload', (resource) => panel.upload(resource)),
        workbench.registerCommand('files.rename', (resource) => panel.rename(resource)),
        workbench.registerCommand('files.delete', (resource) => panel.delete(resource)),
        ...NEW_ENTRIES.flatMap((entry) => [
          workbench.registerMenuItem(NEW_FILE_MENU, { ...entry, group: 'navigation' }),
          workbench.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'navigation' }),
        ]),
        ...CHANGE_ENTRIES.map((entry) => workbench.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'modification', when: (context) => !context.resourceIsMain })),
        workbench.onDidShowFile(render),
        workbench.onDidChangeFileDecorations(() => panel.render(state())),
        workbench.onDidChangeMenu((menuId) => menuId === NEW_FILE_MENU && panel.render(state())),
      );
      if (mode !== 'hide') subscriptions.push(workbench.onDidDropFiles((dropped) => void panel.uploadFiles(dropped)));
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
