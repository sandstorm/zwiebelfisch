// See Workbench in workbench.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges, uploadTarget } from '../../core/uploads/uploads';
import type { User } from '../../core/user/user';
import { CommandsHost, keyLabel } from '../commands/commands';
import { LanguagesHost } from '../languages/languages';
import { Preview } from '../preview/preview';
import { ScmHost } from '../scm/scm';
import { SourceEditorHost } from '../source-editor/source-editor';
import { VisualEditorHost } from '../visual-editor/visual-editor';
import { type TextEditorSelectionChangeEvent, WindowHost } from '../window/window';
import { type Settings, WorkspaceHost } from '../workspace/workspace';
import { ColorScheme } from './color-scheme/color-scheme';
import { type DocumentDrops, sourceEditorDrops, visualEditorDrops } from './document-drops/document-drops';
import { EditorTabs } from './editor-tabs/editor-tabs';
import { ExtensionHost } from './extension-host/extension-host';
import { FileDrops } from './file-drops/file-drops';
import { WorkbenchLayout } from './layout/workbench-layout';
import { Menus } from './menus/menus';
import { StorageMemento } from './memento/memento';
import { StyleSheets } from './style-sheets/style-sheets';
import { DocumentEditors } from './document-editors/document-editors';
import css from './workbench.css?inline';
import type { MenuItem } from '../commands/commands';
import type { Extension, Workbench, OpenOptions, SidePanelOptions, SidePanel, WorkbenchOptions } from './workbench';

/**
 * The frame of the widget on `host`: shows the project's files in custom editors (Typst files in the Visual and the
 * Source editor, others in those extensions register, tabs between them; side panels on the left and the right, the
 * preview being the right side's built-in one; the status bar), keeps the preview compiling the main file, and runs the
 * extensions. It makes the other hosts: VS Code's namespaces (`commands`, `window`, `scm`, `languages`, `workspace`)
 * and the editors' and the preview's (`visualEditor`, `sourceEditor`, `preview`). `activate` starts it: extensions
 * first (their contributions are in place before any editor exists), then the main file is shown and compiled.
 * createEditor creates it; extensions see it as `Workbench`.
 */
export class WorkbenchHost implements Workbench {
  #active: ProjectPath;
  /** The view type of the custom editor shown; undefined while none is. */
  #activeCustomEditorId: string | undefined;
  /** The commands, for the widget's `executeCommand`. */
  readonly commands: CommandsHost;
  readonly #layout: WorkbenchLayout;
  readonly #documentEditors: DocumentEditors;
  readonly #tabs: EditorTabs;
  /** The window, for the widget's `activeFile`. */
  readonly window: WindowHost;
  readonly #languages = new LanguagesHost();
  readonly #scm = new ScmHost();
  readonly #menus = new Menus();
  readonly #workspace: WorkspaceHost;
  readonly #drops: FileDrops;
  readonly #scheme: ColorScheme;
  readonly #extensions: ExtensionHost;
  readonly #styleSheets: StyleSheets;
  readonly #ownStyles: Disposable;
  readonly #sourceEditors = new SourceEditorHost();
  /** Its raw boxes' code takes the CodeMirror contributions (`editor: 'rawBox'`, as Typst in its file); its toolbar the menus. */
  readonly #visualEditor = new VisualEditorHost({
    rawBoxCodeMirrorExtensions: ({ document }) =>
      this.#sourceEditors.codeMirrorExtensionsFor({ editor: 'rawBox', languageId: 'typst', path: () => this.project.pathOf(document) ?? null, document }),
    menus: {
      getMenuItems: (menuId, context) => this.#menus.items(menuId, context),
      onDidChangeMenu: this.#menus.onDidChange,
      executeCommand: (command, ...args) => this.commands.executeCommand(command, ...args),
      keybindingLabel: (command) => this.commands.keybindingLabel(command),
    },
  });
  readonly #preview: Preview;
  #frame: { top: HTMLElement; bottom: HTMLElement } | null = null;
  readonly #railActions: Disposable;
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #selectionChanged = new EventEmitter<TextEditorSelectionChangeEvent>();
  readonly #subscription: Disposable;
  /** Who works here since `setUser` (else the host's `user`). */
  #user: User | undefined;

  readonly onDidDropFiles: Event<File[]>;
  readonly onDidChangeMenu = this.#menus.onDidChange;

  constructor(
    private readonly host: HTMLElement,
    private readonly project: Project,
    private readonly options: WorkbenchOptions = {},
  ) {
    this.#active = project.main;
    this.#styleSheets = new StyleSheets(host);
    const frameStyles = this.#styleSheets.add((options.styleSheet ?? '') + css, 'zwf-editor-styles');
    host.classList.add('zwf-editor');
    this.#workspace = new WorkspaceHost(project, { settings: options.settings, allowFileChange: options.allowFileChange });
    this.#workspace.declare(WORKBENCH_SETTINGS);
    this.#scheme = new ColorScheme(host);
    this.#applyTheme();
    const doc = host.ownerDocument;
    this.commands = new CommandsHost(host);
    this.#layout = new WorkbenchLayout(host, StorageMemento.of(doc, 'sessionStorage', `zwf:${project.main}:workbench:`), this.commands);
    this.#drops = new FileDrops(host);
    this.onDidDropFiles = this.#drops.onDidDrop;
    this.#tabs = new EditorTabs(this.#layout.editor, this.#menus, {
      onDidChoose: (viewType) => this.open(this.#active, { viewType }),
      context: () => ({ activeCustomEditorId: this.#activeCustomEditorId, resource: this.#active }),
      commands: this.commands,
      showContextMenu: (menuId, menuOptions) => this.window.showContextMenu(menuId, menuOptions),
    });
    this.#documentEditors = new DocumentEditors(project, {
      visualEditor: this.#visualEditor,
      sourceEditors: this.#sourceEditors,
      // Fired from the editors' own updates: the DOM's selectionchange fires before
      // CodeMirror/ProseMirror read the new selection, so a listener would see the previous one.
      onSelection: (textEditor) => this.#selectionChanged.fire({ textEditor }),
    });
    this.window = this.#createWindow();
    this.#preview = this.#createPreview();
    // the hosts' CSS after the tokens and the frame, before the extensions'
    const hosts = [this.window, this.#preview, this.#sourceEditors, this.#visualEditor];
    this.#ownStyles = Disposable.from(frameStyles, ...hosts.map((part) => this.#styleSheets.add(part.styleSheet)));
    this.#subscription = Disposable.from(project.onDidChangeFile((change) => this.#changed(change)), project.onDidChangeMain(() => this.#compile()));
    this.#extendEditors();
    this.#railActions = this.#menus.onDidChange((menuId) => this.#showRailActions(menuId));
    this.#applyRightSidePanel();
    this.#workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbench.theme')) this.#applyTheme();
      if (event.affectsConfiguration('workbench.rightSidePanel')) this.#applyRightSidePanel();
    });
    this.#extensions = new ExtensionHost(
      {
        project,
        commands: this.commands,
        window: this.window,
        scm: this.#scm,
        languages: this.#languages,
        workspace: this.#workspace,
        workbench: this,
        visualEditor: this.#visualEditor,
        sourceEditor: this.#sourceEditors,
        preview: this.#preview,
      },
      (id) => ({
        globalState: StorageMemento.of(doc, 'localStorage', `zwf:global:${id}:`),
        workspaceState: StorageMemento.of(doc, 'sessionStorage', `zwf:${project.main}:${id}:`),
      }),
    );
  }

  /**
   * Declares the settings, keys and languages of `extensions`, activates them (in order), then shows the main file and compiles it. Once.
   * Values set for settings no one declares are reported (console) and ignored.
   */
  activate(extensions: readonly Extension[]): void {
    for (const extension of extensions) {
      this.#workspace.declare(extension.contributes?.configuration?.properties ?? {});
      this.#languages.declare(extension.contributes?.languages ?? []);
      this.commands.declareKeybindings(extension.contributes?.keybindings);
      this.commands.declareCommands(extension.contributes?.commands);
      this.#menus.declareCommands(extension.contributes?.commands);
    }
    this.#workspace.check();
    this.#extensions.activate(extensions);
    this.open(this.project.main, { viewType: this.options.viewType });
    this.#compile();
  }

  get ownerDocument(): Document {
    return this.host.ownerDocument;
  }

  get user(): User | undefined {
    return this.#user ?? this.options.user;
  }

  setUser(user: User): void {
    this.#user = user;
  }

  /** The settings' values the host set, by full id. */
  get settings(): Settings {
    return this.#workspace.values;
  }

  /** Merges `settings` into them (`undefined` resets an id to its default); listeners hear what changed. */
  updateSettings(settings: Settings): void {
    this.#workspace.update(settings);
  }

  open(path: ProjectPath, options: OpenOptions = {}): void {
    if (!this.project.has(path)) return;
    this.#active = path;
    this.#activeCustomEditorId = this.window.showCustomEditor({ path, content: this.project.content(path)! }, options.viewType, options.selection);
    this.#tabs.update(this.window.customEditorChoices(path), this.#activeCustomEditorId);
    this.#placeFrame();
    this.#shown.fire(path);
  }

  registerSidePanel(id: string, options: SidePanelOptions): SidePanel {
    return this.#layout.addPanel(id, options);
  }

  registerStyleSheet(css: string): Disposable {
    return this.#styleSheets.add(css);
  }

  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable {
    if (this.#frame) throw new Error('There is an editor frame already');
    this.#frame = frame;
    this.#documentEditors.setFrame(frame);
    this.#placeFrame();
    return new Disposable(() => {
      this.#frame = null;
      this.#documentEditors.setFrame(null);
      frame.top.remove();
      frame.bottom.remove();
    });
  }

  registerMenuItem<C extends object>(menuId: string, item: MenuItem<C>): Disposable {
    return this.#menus.register(menuId, item);
  }

  getMenuItems<C extends object>(menuId: string, context?: C): readonly MenuItem<C>[] {
    return this.#menus.items(menuId, context);
  }

  isEditorFocused(): boolean {
    const area = this.#layout.editor;
    const root = area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && area.contains(root.activeElement);
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#extensions.dispose();
    this.#railActions.dispose();
    this.window.dispose();
    this.#tabs.dispose();
    this.#scm.dispose();
    this.#menus.dispose();
    this.#preview.dispose();
    this.commands.dispose();
    this.#workspace.dispose();
    this.#drops.dispose();
    for (const emitter of [this.#shown, this.#selectionChanged]) emitter.dispose();
    this.host.classList.remove('zwf-editor');
    delete this.host.dataset.theme;
    this.#scheme.dispose();
    this.#layout.dispose();
    this.#ownStyles.dispose();
  }

  /**
   * The window, its editing area showing Typst files in the Visual and Source editors: registered first, they win ties
   * for `*.typ`. It follows file changes before the workbench does, so a retained panel follows a rename before the
   * renamed file is shown again. Its custom editors (these included) go with it.
   */
  #createWindow(): WindowHost {
    const window = new WindowHost({
      exists: (path) => this.project.has(path),
      host: this.host,
      statusBar: this.#layout.statusBar,
      editingArea: this.#layout.editor,
      onDidChangeFile: this.project.onDidChangeFile,
      activeFile: () => this.#active,
      onDidChangeActiveFile: this.#shown.event,
      activeTextEditor: () => this.#documentEditors.activeTextEditor,
      onDidChangeTextEditorSelection: this.#selectionChanged.event,
      menuItems: (menuId, context) => this.#menus.items(menuId, context).map((item) => ({ ...item, keybinding: this.commands.keybindingLabel(item.command) ?? (item.keybinding && keyLabel(item.keybinding)) })),
      executeCommand: (command, ...args) => this.commands.executeCommand(command, ...args),
    });
    this.#documentEditors.register(window);
    return window;
  }

  /**
   * The preview, in the right side's built-in panel `preview` (registered before any extension, so first among equal
   * orders). It compiles whether shown or not: diagnostics, raw box snippets and the selection highlight never wait
   * for it to be shown.
   */
  #createPreview(): Preview {
    const panel = this.#layout.addPanel('preview', { label: 'Preview', icon: previewIcon(this.host.ownerDocument), side: 'right' });
    return new Preview(panel.body);
  }

  /**
   * The editor frame around the shown custom editor's panel, unless a Typst editor is shown (DocumentEditors puts it into
   * the editor's scrolling content then).
   */
  #placeFrame(): void {
    if (!this.#frame || this.#documentEditors.activeTextEditor) return;
    const panel = this.window.activeCustomEditorElement();
    if (panel) {
      panel.before(this.#frame.top);
      panel.after(this.#frame.bottom);
    } else {
      this.#frame.top.remove();
      this.#frame.bottom.remove();
    }
  }

  /** The rail buttons of the menus `workbench/rail/left` and `workbench/rail/right`, anew when `menuId` is one of them. */
  #showRailActions(menuId: string): void {
    const side = RAIL_MENUS.find((candidate) => menuId === `workbench/rail/${candidate}`);
    if (!side) return;
    const actions = this.#menus.items(menuId).map(({ command, title, icon, order }) => ({ command, title: title ?? command, icon: icon ?? '', order: order ?? 0 }));
    this.#layout.setRailActions(side, actions);
  }

  /** The right side's default panel from the setting `workbench.rightSidePanel`. */
  #applyRightSidePanel(): void {
    this.#layout.setDefaultPanel('right', this.#workspace.getConfiguration('workbench').get<string | null>('rightSidePanel'));
  }

  /**
   * The Typst files' language, `typst` (`.typ`). A project file (a row of the file panel) dropped into a Visual or
   * Source editor becomes what the drop edit providers (`languages.registerDocumentDropEditProvider`) make of it,
   * inserted where it was dropped; so does a file from the computer, once uploaded (`#upload`): the providers know only
   * project files.
   */
  #extendEditors(): void {
    this.#languages.declare([{ id: 'typst', extensions: ['.typ'] }]);
    const drops: DocumentDrops = {
      edit: (document, offset, file) => {
        const path = this.project.pathOf(document);
        return path ? this.#languages.provideDocumentDropEdit({ path, languageId: 'typst', text: document.text }, offset, file) : null;
      },
      upload: (document, files) => this.#upload(document, files),
    };
    this.#visualEditor.registerTiptapExtension(({ document }) => visualEditorDrops(document, drops));
    this.#sourceEditors.registerCodeMirrorExtension({ editor: 'source' }, (editor) => (editor.editor === 'source' ? sourceEditorDrops(editor.document, drops) : []));
  }

  /**
   * Adds `files` from the computer, dropped into `document`, to the project (`workspace.applyEdit`), each in the folder
   * the drop edit providers name (`languages.provideUploadFolder`; default: the top) under its name, or under the
   * first free one of `name-2.ext`, … unless a file of that name has the same content (`uploadTarget`); a refusal is
   * an error message. Resolves to the files' paths in the project, without the refused ones.
   */
  async #upload(document: TypstDocument, files: File[]): Promise<ProjectPath[]> {
    const paths: ProjectPath[] = [];
    const file = this.project.pathOf(document);
    const text = { path: file!, languageId: 'typst', text: document.text };
    for (const change of await uploadChanges(files)) {
      if (change.kind !== 'create') continue;
      const folder = file ? this.#languages.provideUploadFolder(text, change.path) : '/';
      const named = ProjectPath.of(folder + ProjectPath.name(change.path));
      const path = uploadTarget(named, change.content, (candidate) => this.project.content(candidate));
      const problem = this.project.has(path) ? null : await this.#workspace.applyEdit({ ...change, path });
      if (problem) void this.window.showErrorMessage(problem);
      else paths.push(path);
    }
    return paths;
  }

  /** `data-theme` from the setting `workbench.theme` (none: as the page), and the scheme the colors resolve to now. */
  #applyTheme(): void {
    const theme = this.#workspace.getConfiguration('workbench').get<string | null>('theme');
    if (theme) this.host.dataset.theme = theme;
    else delete this.host.dataset.theme;
    this.#scheme.update();
  }

  #compile(): void {
    this.#preview.update(this.project.files(), this.project.main);
  }

  #changed(change: FileChange): void {
    this.#compile();
    if (change.kind !== 'update') this.#restructured(change);
  }

  /** Keeps the editing area on an existing file after a create / rename / delete (a renamed file stays shown). */
  #restructured(change: FileChange): void {
    const active = this.#active;
    if (change.kind === 'rename' && change.from === active) this.open(change.path);
    else this.open(this.project.has(active) ? active : this.project.main);
  }
}

/** The workbench's own settings. */
const WORKBENCH_SETTINGS = {
  'workbench.theme': {
    type: ['string', 'null'],
    enum: ['light', 'dark', 'auto', null],
    default: null,
    description:
      'Light or dark colors, or `auto`: as the OS. Default (null): as the page around the widget, through CSS `color-scheme`. In dark mode the preview shows the pages inverted; the PDF stays as it is.',
  },
  'workbench.rightSidePanel': {
    type: ['string', 'null'],
    default: 'preview',
    description:
      "The side panel the right side shows until the viewer picks one with its rail: `preview`, or an extension's panel id (e.g. `devtools`); null: the right side starts hidden (the editing area takes its room). A panel id not registered: the right panel that asks for it (`setDefault`), if any.",
  },
} as const;

/** The preview's rail button: a page. */
function previewIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3M6.5 8h4M6.5 10.5h4"/>';
  return svg;
}

/** The sides whose rail shows a menu's items (`workbench/rail/<side>`). */
const RAIL_MENUS = ['left', 'right'] as const;
