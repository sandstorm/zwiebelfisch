// The files extension: the file panel (the project's files as a tree in the left side panel: new file / folder,
// upload, rename, delete as commands in its menus, drag & drop, file decorations). Entry of extensions/files/. See
// ARCHITECTURE.md, "File panel".
// Why a controller and views: the extension is a controller over the workbench's contribution points (a side panel,
// commands, menus) and the project; the views (workbench/) and the pure tree model (model/) get what they need of the
// workbench as options, so the panel is tested without one.
import { Disposable } from '../../core/disposable/disposable';
import type { ProjectPath } from '../../core/paths/paths';
import type { TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import css from './files.css?inline';
import { CONTEXT_MENU, FilePanel, NEW_FILE_MENU, type FilePanelOptions } from './workbench/file-panel';
import { icon } from './workbench/icons/icons';

/** When the file panel is open (the setting `files.panel`). */
type PanelMode = 'auto' | 'show' | 'hide';

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
 * from every `FileDecorationProvider` (e.g. where collaborators are). The setting `files.panel` says when it is open.
 * Its operations are commands (`files.newFile`, `files.newFolder`, `files.upload`, `files.rename`, `files.delete`,
 * each on a row), offered in two menus any extension may add to: `file/newFile` ("New" in the panel's header) and `explorer/context` (a row's context menu;
 * context: `resource`, `resourceKind` 'file' | 'folder', `resourceIsMain`; the command gets the row).
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
        prompts: workbench,
        menus: panelMenus(workbench),
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
        drops = shown === 'hide' ? null : workbench.onDidDropFiles((dropped) => void panel.uploadFiles(dropped));
      };
      render();
      subscriptions.push(
        side,
        panel,
        new Disposable(() => drops?.dispose()),
        registerOperations(workbench, panel),
        workbench.onDidShowFile(render),
        workbench.onDidChangeFileDecorations(() => panel.render(state())),
        workbench.onDidChangeMenu((menuId) => menuId === NEW_FILE_MENU && panel.render(state())),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('files.panel')) render();
        }),
      );
    },
  };
}

/** The panel's operations as commands, and its own entries in "New" and in a row's context menu. */
function registerOperations(workbench: Workbench, panel: FilePanel): Disposable {
  return Disposable.from(
    workbench.registerCommand('files.newFile', (resource?: ProjectPath) => panel.newFile(resource)),
    workbench.registerCommand('files.newFolder', (resource?: ProjectPath) => panel.newFolder(resource)),
    workbench.registerCommand('files.upload', (resource?: ProjectPath) => panel.upload(resource)),
    workbench.registerCommand('files.rename', (resource?: ProjectPath) => panel.rename(resource)),
    workbench.registerCommand('files.delete', (resource?: ProjectPath) => panel.delete(resource)),
    ...NEW_ENTRIES.flatMap((entry) => [
      workbench.registerMenuItem(NEW_FILE_MENU, { ...entry, group: 'navigation' }),
      workbench.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'navigation' }),
    ]),
    ...CHANGE_ENTRIES.map((entry) => workbench.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'modification', when: (context) => !context.resourceIsMain })),
  );
}

/** The panel's menus: their entries (any extension's) and how one runs: its command by id, with the row as argument. */
function panelMenus(workbench: Workbench): FilePanelOptions['menus'] {
  return {
    items: (menuId, context) => workbench.getMenuItems(menuId, context),
    run: (command, resource) => void workbench.executeCommand(command, resource).catch((error: unknown) => console.error(`Command ${command} failed:`, error)),
  };
}
