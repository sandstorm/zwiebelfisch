import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { MenuContext } from '../../hosts/commands/commands';
import type { ExtensionContext, Extension } from '../../hosts/extension-host/extension-host';
import css from './files.css?inline';
import { fileInfoEditor } from './workbench/file-info';
import { CONTEXT_MENU, FilePanel, NEW_FILE_MENU } from './workbench/file-panel';
import { fileSearch } from './workbench/file-search';
import { FILES_ICON } from './workbench/icons/icons';

/**
 * The file panel: the project's files as a tree in the left side panel.
 * Also the files in search everywhere ("Files", prefix `/`) and a read-only editor for any file no other editor opens
 * (`files.file`: its name, size and type).
 *
 * Other extensions use it through:
 * - the menus `file/newFile` ("New" in the panel's header) and `explorer/context` (a row's context menu; context
 *   `resource`, `resourceKind` 'file' | 'folder', `resourceIsMain`; the command gets the row)
 * - the commands `files.newFile`, `files.newFolder`, `files.upload`, `files.rename`, `files.delete`, `files.setMainFile`
 * - FileDecorationProviders, whose decorations show as badges on the rows
 *
 * The setting `files.panel` says when the panel is open; Alt+1 (⌃1 on the Mac) shows and focuses it.
 */
export function files(): Extension {
  return {
    id: 'files',
    contributes: {
      commands: COMMANDS,
      configuration: { properties: { 'files.panel': PANEL_SETTING } },
      // ⌘1 / Ctrl+1 are the browser's tabs, ⌥1 types a character on the Mac, Linux browsers take Alt+1 and Ctrl+1
      keybindings: [{ command: 'workbench.view.files', key: 'Alt+Digit1', mac: 'Ctrl+Digit1', linux: '' }],
    },
    activate(context) {
      const { project, window, workspace, subscriptions } = context;
      const mode = () => workspace.getConfiguration('files').get<PanelMode>('panel', 'auto');
      const side = window.registerSidePanel('files', { label: 'Files', icon: FILES_ICON, order: 10 });
      const state = () => ({ paths: project.paths(), main: project.main, active: window.activeFile });
      const panel = new FilePanel(side.body, {
        onOpen: (path) => {
          window.showDocument(path);
          side.dismiss();
        },
        onChange: (change) => workspace.applyEdit(change),
        prompts: window,
        hasMenuItems: (menuId, menuContext) => window.getMenuItems(menuId, menuContext).length > 0,
        state: context.workspaceState,
        decorations: (path) => window.getFileDecorations(path),
        icon: (path) => window.getFileIcon(path),
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
        drops = shown === 'hide' ? null : window.onDidDropFiles((dropped) => void panel.uploadFiles(dropped));
      };
      render();
      subscriptions.push(
        window.registerStyleSheet(css),
        side,
        panel,
        window.registerCustomEditorProvider('files.file', fileInfoEditor, { filenamePattern: '*', displayName: 'File', priority: 'fallback' }),
        new Disposable(() => drops?.dispose()),
        registerOperations(context, panel),
        window.registerSearchProvider(fileSearch(project, window)),
        window.onDidChangeActiveFile(render),
        project.onDidChangeMain(() => panel.render(state())),
        window.onDidChangeFileDecorations(() => panel.render(state())),
        window.onDidChangeMenu((menuId) => menuId === NEW_FILE_MENU && panel.render(state())),
        workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration('files.panel')) render();
        }),
      );
    },
  };
}

/** The operations as people find them (search everywhere): on the focused row of the panel, else the shown file. */
const COMMANDS = [
  { command: 'files.newFile', title: 'New file…', category: 'Files' },
  { command: 'files.newFolder', title: 'New folder…', category: 'Files' },
  { command: 'files.upload', title: 'Upload files…', category: 'Files' },
  { command: 'files.rename', title: 'Rename…', category: 'Files' },
  { command: 'files.delete', title: 'Delete…', category: 'Files' },
  { command: 'files.setMainFile', title: 'Set as main file', category: 'Files' },
];

const PANEL_SETTING = {
  type: 'string',
  enum: ['auto', 'show', 'hide'],
  default: 'auto',
  description: 'When the file panel is open: auto while the project has more than one file, else collapsed to its rail button (until someone opens or closes it); show: open; hide: none at all (and files dropped beside the text are ignored).',
} as const;

/** When the file panel is open (the setting `files.panel`). */
type PanelMode = 'auto' | 'show' | 'hide';

/** The panel's operations as commands, and its own entries in "New" and in a row's context menu. */
function registerOperations({ commands, project, window }: ExtensionContext, panel: FilePanel): Disposable {
  // a .typ file that is not the main file yet, while the host lets the main file change
  const mainCandidate = (context: MenuContext) =>
    !project.mainLocked && context.resourceKind === 'file' && !context.resourceIsMain && ProjectPath.isTypst(context.resource as ProjectPath);
  return Disposable.from(
    commands.registerCommand('files.newFile', (resource?: ProjectPath) => panel.newFile(resource)),
    commands.registerCommand('files.newFolder', (resource?: ProjectPath) => panel.newFolder(resource)),
    commands.registerCommand('files.upload', (resource?: ProjectPath) => panel.upload(resource)),
    commands.registerCommand('files.rename', (resource?: ProjectPath) => panel.rename(resource)),
    commands.registerCommand('files.delete', (resource?: ProjectPath) => panel.delete(resource)),
    commands.registerCommand('files.setMainFile', (resource?: ProjectPath) => {
      const problem = project.setMain(resource ?? window.activeFile);
      if (problem) void window.showErrorMessage(problem);
    }),
    ...NEW_ENTRIES.flatMap((entry) => [
      window.registerMenuItem(NEW_FILE_MENU, { ...entry, group: 'navigation' }),
      window.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'navigation' }),
    ]),
    window.registerMenuItem(CONTEXT_MENU, { command: 'files.setMainFile', group: 'main', when: mainCandidate }),
    ...CHANGE_ENTRIES.map((entry) => window.registerMenuItem(CONTEXT_MENU, { ...entry, group: 'modification', when: (context) => !context.resourceIsMain })),
  );
}

/** The panel's own entries: in "New" (`file/newFile`) and in a row's context menu (`explorer/context`). */
const NEW_ENTRIES = [
  { command: 'files.newFile', order: 10 },
  { command: 'files.newFolder', order: 20 },
  { command: 'files.upload', order: 30 },
] as const;

// the row's own menu says "Delete" (as VS Code's), people search for "Delete…"
const CHANGE_ENTRIES = [
  { command: 'files.rename', order: 10 },
  { command: 'files.delete', title: 'Delete', order: 20 },
] as const;
