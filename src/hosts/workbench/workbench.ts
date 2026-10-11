// The workbench host: the widget's frame (side panels, editing area with the Visual / Source tabs and custom editors,
// preview, status bar), the extension API every feature uses to put itself into it, and the composition of the
// other hosts. Entry of hosts/workbench/.
// Why extensions: the frame knows no feature by name. A feature is a `TypstExtension` that registers what it adds
// (a side panel, a custom editor, a command, a menu item, a link provider, a source control) once, at activation, and the
// host disposes all of it on dispose. The API is VS Code's namespaces, each a host of its own (`commands`, `window`,
// `scm`, `languages`, `workspace`); `workbench` is only the frame. Adding a feature is adding it to a list, not
// editing the frame. Extensions never depend on each other: what one offers another goes through a generic
// contribution point of a host.
// See ARCHITECTURE.md, "Extensions" and "Layout".
// WorkbenchHost (below the API) is what createTypstEditor creates; extensions see it as `Workbench`.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { User } from '../../core/user/user';
import { type Commands, CommandsHost } from '../commands/commands';
import { type Languages, LanguagesHost } from '../languages/languages';
import { Preview, type PreviewContributions } from '../preview/preview';
import { type Scm, ScmHost } from '../scm/scm';
import { SourceViewHost, type SourceViewContributions } from '../source-view/source-view';
import { VisualViewContributions } from '../visual-view/visual-view';
import { type EditorMode, type TextEditorSelectionChangeEvent, type Window, WindowHost } from '../window/window';
import { type ConfigurationProperty, type Settings, type Workspace, WorkspaceHost } from '../workspace/workspace';
import { ColorScheme } from './color-scheme/color-scheme';
import { EditingViews } from './editing-views/editing-views';
import { ExtensionHost } from './extension-host/extension-host';
import { FileDrops } from './file-drops/file-drops';
import { Layout } from './layout/layout';
import layoutStyles from './layout/layout.css?inline';
import { EditorTitleMenu } from './menus/editor-title-menu';
import { Menus } from './menus/menus';
import { SessionMemory } from './memory/session-memory';
import { StyleSheets } from './style-sheets/style-sheets';

/**
 * A feature of the widget: activated once, in list order; what it registers goes into `context.subscriptions`.
 * Hosts write their own the same way and give them to `createTypstEditor({ extensions })`.
 */
export interface TypstExtension {
  /** Unique in the list (e.g. `files`); a host replaces a built-in by leaving out the one with this id. */
  readonly id: string;
  /**
   * What the extension declares before any extension is activated (VS Code's `contributes` in an extension's
   * manifest): its settings.
   */
  readonly contributes?: ExtensionContributions;
  /** Registers the extension's contributions; everything it pushes into `context.subscriptions` is disposed with the widget. */
  activate(context: ExtensionContext): void;
}

/** What an extension declares up front (VS Code's `contributes`). */
export interface ExtensionContributions {
  /**
   * Its settings by full id, `<section>.<key>` with the extension's own section (`pdfExport.download`). The host sets
   * values with `createTypstEditor({ settings })`; the extension reads them with `workspace.getConfiguration`.
   */
  readonly configuration?: { readonly properties: Readonly<Record<string, ConfigurationProperty>> };
}

/**
 * What an extension gets to work with: VS Code's namespaces, the frame, and the hosts of the views. Contributions are
 * registered once, at activation; the hosts apply them to every view they create later.
 */
export interface ExtensionContext {
  /** Disposed when the widget is disposed, in reverse order (the extensions in reverse list order, too). */
  readonly subscriptions: { dispose(): unknown }[];
  readonly project: Project;
  /** Commands by id and their key bindings (VS Code's `commands` namespace). */
  readonly commands: Commands;
  /** Messages, input box, quick pick, status bar items, custom editors, file decorations, the active editor (VS Code's `window`). */
  readonly window: Window;
  /** The source controls (VS Code's `scm`). */
  readonly scm: Scm;
  /** The document links of Typst text (VS Code's `languages`). */
  readonly languages: Languages;
  /** The project's changes (`applyEdit`) and the settings (VS Code's `workspace` namespace). */
  readonly workspace: Workspace;
  /** The frame: which file is shown, side panels, the editor frame, menus, style sheets, dropped files. */
  readonly workbench: Workbench;
  /** Node and mark specs, toolbar items, gutters, box renderers and editor extensions for every Visual view. */
  readonly visualView: VisualViewContributions;
  /** CodeMirror extensions for every Source view. */
  readonly sourceView: SourceViewContributions;
  /** Toolbar items and PDF export options of the preview; reveal and clicks; its compile results (diagnostics, snippets, PDFs). */
  readonly preview: PreviewContributions;
}

/** The widget's frame as extensions see it: which file is shown, and the places of the frame they can put things. */
export interface Workbench {
  /** The document the widget lives in, to create elements for it. */
  readonly ownerDocument: Document;
  /** The file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /** Who works in the widget, as the host said (`createTypstEditor({ user })`); undefined: anonymous. */
  readonly user: User | undefined;
  /**
   * Shows `path` in the editing area (if the project has it): a Typst file in the Visual / Source tabs, any other
   * file in its custom editor (`window.registerCustomEditorProvider`; `viewType` picks one, else the default one;
   * nothing without one). Opening the shown file again shows it again (its editor gets the current content in a new
   * panel). `selection` reveals a range of a Typst file, in the Source tab with `mode`.
   */
  open(path: ProjectPath, options?: OpenOptions): void;
  /** After a file was shown in the editing area (also when the same file is shown again). */
  readonly onDidShowFile: Event<ProjectPath>;

  /**
   * Adds `css` where the widget renders (the page's `<head>`, or the shadow root of a `<typst-editor>`), after the
   * widget's own stylesheet, until disposed. An extension styles what it adds this way, under class names of its own,
   * with the colors of the `--te-*` tokens (light and dark). Widgets in one root share each stylesheet.
   */
  registerStyleSheet(css: string): Disposable;
  /** Adds a side panel with its rail button (one panel is open at a time); disposing removes both. */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /**
   * Shows `top` right before and `bottom` right after the shown Typst file's content (in the Visual tab below its
   * toolbar), scrolling with it, across tab and file switches; detached while no Typst file is shown. One frame at a time.
   */
  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget (and not taken by a view inside, such as the Visual view
   * taking images). The widget never lets the browser open a dropped file; it shows the drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;
  /** A value remembered for the browser session under this widget's key (`name` tells values apart). */
  remember<T>(name: string): Memory<T>;

  /**
   * Adds `item` to the menu `menuId` until disposed (VS Code's `contributes.menus`). Whoever shows a menu renders
   * the items whose `when` holds there, sorted by `group` and `order`, and runs an item's command with the menu's
   * arguments. The workbench shows `editor/title`: the Visual / Source tab bar (context: `editorMode`, `resource`
   * (the shown file); no arguments). Other ids are menus of views that extensions show, documented there (the file
   * panel: `file/newFile`, `explorer/context`).
   */
  registerMenuItem(menuId: string, item: MenuItem): Disposable;
  /** The items of `menuId` to show in `context` (those whose `when` holds), sorted, for a view that shows that menu. */
  getMenuItems(menuId: string, context?: MenuContext): readonly MenuItem[];
  /** Items of a menu (its id) were registered or disposed. */
  readonly onDidChangeMenu: Event<string>;

  /** Whether the user works in the editing area (the focus is inside it). */
  isEditorFocused(): boolean;
}

/** One entry of a menu (VS Code's `contributes.menus` entry): a command by its id, shown while `when` holds. */
export interface MenuItem {
  /** The command the entry runs (`commands.executeCommand`), with the arguments of the menu it is in. */
  readonly command: string;
  /** What the entry says; default: the command id. */
  readonly title?: string;
  /** An SVG icon (markup drawn in `currentColor`) before the title, where the menu shows icons (the tab bar). */
  readonly icon?: string;
  /**
   * Whether the entry shows, given the context the menu is shown in (e.g. `(context) => context.resourceKind ===
   * 'folder'`); default: always. Asked each time the menu is shown.
   */
  readonly when?: (context: MenuContext) => boolean;
  /** Entries are grouped by this: `navigation` first, the others by name, a separator between groups; default ''. */
  readonly group?: string;
  /** The place in its group (lower first; equal: registration order); default 0. */
  readonly order?: number;
}

/** What a menu is shown for (VS Code's context keys), by key, e.g. `{ editorMode: 'source', resource: '/main.typ' }`. */
export type MenuContext = Readonly<Record<string, unknown>>;

export interface OpenOptions {
  /** A range of the Typst file (source offsets) to reveal. */
  selection?: { from: number; to: number };
  /** Reveals in that tab (switching to it); default: the current one. */
  mode?: EditorMode;
  /** The custom editor to open a file that is not Typst source in (its view type); default: the one its name picks. */
  viewType?: string;
}

export interface SidePanelOptions {
  /** Shown on the rail button (as its tooltip and accessible name). */
  label: string;
  /** The rail button's icon. */
  icon: Element;
  /** The rail button's place among the others (lower first; equal: registration order); default 0. */
  order?: number;
}

/** A registered side panel: the element its content goes into, and how it opens. */
export interface SidePanel {
  readonly body: HTMLElement;
  /** Opens it by default (unless someone opened or closed it this session, or the widget is narrow). */
  setDefault(open: boolean): void;
  /** Shows or removes it and its rail button altogether (e.g. the setting `files.panel: 'hide'`). */
  setAvailable(available: boolean): void;
  /** Closes it if it lies over the editing area (narrow widget), e.g. after something was chosen in it. */
  dismiss(): void;
  dispose(): void;
}

/** Remembers one value for the browser session (when storage is available). */
export interface Memory<T> {
  load(): T | null;
  save(value: T): void;
}

/**
 * The drag data type (`DataTransfer`) of a project file dragged inside the widget, e.g. a row of the file panel; the
 * data is its path. Any view may take such a drop (the Visual view inserts a dragged image).
 */
export const PROJECT_PATH_TYPE = 'application/x-typst-project-path';

export interface WorkbenchOptions {
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** Who works here (`Workbench.user`). */
  user?: User;
  /**
   * The settings' values by full id (the workbench's own `workbench.theme`, and the extensions'), changeable later
   * (`settings`).
   */
  settings?: Settings;
  /** The host's veto on a change someone asked for (`workspace.applyEdit`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /** Another file is shown in the editing area. */
  onOpen?(path: ProjectPath): void;
  /**
   * The widget's own CSS (the other hosts' included), put where it renders before the frame is built (the color
   * scheme reads the resolved colors), as `<style id="typst-editor-styles">` together with the frame's own layout
   * CSS; the extensions' stylesheets follow it.
   */
  styleSheet?: string;
}

/**
 * The frame of the widget on `host`: shows the project's files (Typst files in the Visual / Source tabs, others in
 * the custom editors extensions register), keeps the preview compiling the main file, and runs the extensions. It
 * makes the other hosts: VS Code's namespaces (`commands`, `window`, `scm`, `languages`, `workspace`) and the views'
 * (`visualView`, `sourceView`, `preview`). `activate` starts it: extensions first (their contributions are in place
 * before any view exists), then the main file is shown and compiled.
 */
export class WorkbenchHost implements Workbench {
  #active: ProjectPath;
  /** The commands, for the widget's `executeCommand`. */
  readonly commands: CommandsHost;
  readonly #layout: Layout;
  readonly #memory: SessionMemory;
  readonly #views: EditingViews;
  readonly #window: WindowHost;
  readonly #languages = new LanguagesHost();
  readonly #scm = new ScmHost();
  readonly #menus = new Menus();
  readonly #editorTitle: EditorTitleMenu;
  readonly #workspace: WorkspaceHost;
  readonly #drops: FileDrops;
  readonly #scheme: ColorScheme;
  readonly #extensions: ExtensionHost;
  readonly #styleSheets: StyleSheets;
  readonly #ownStyles: Disposable;
  readonly #visualView = new VisualViewContributions();
  readonly #sourceViews = new SourceViewHost();
  readonly #preview: Preview;
  #hasFrame = false;
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #selectionChanged = new EventEmitter<TextEditorSelectionChangeEvent>();
  readonly #subscription: Disposable;

  readonly onDidShowFile = this.#shown.event;
  readonly onDidDropFiles: Event<File[]>;
  readonly onDidChangeMenu = this.#menus.onDidChange;

  constructor(
    private readonly host: HTMLElement,
    private readonly project: Project,
    private readonly options: WorkbenchOptions = {},
  ) {
    this.#active = project.main;
    this.#styleSheets = new StyleSheets(host);
    this.#ownStyles = Disposable.from(
      this.#styleSheets.add((options.styleSheet ?? '') + layoutStyles, 'typst-editor-styles'),
      this.#styleSheets.add(this.#languages.styleSheet),
    );
    host.classList.add('typst-editor');
    this.#workspace = new WorkspaceHost(project, { settings: options.settings, allowFileChange: options.allowFileChange });
    this.#workspace.declare(WORKBENCH_SETTINGS);
    this.#scheme = new ColorScheme(host);
    this.#applyTheme();
    this.#memory = new SessionMemory(host.ownerDocument, `typst-editor:${project.main}`);
    this.#layout = new Layout(host, this.#memory);
    this.commands = new CommandsHost(host);
    this.#drops = new FileDrops(host);
    this.onDidDropFiles = this.#drops.onDidDrop;
    this.#views = this.#createViews();
    this.#editorTitle = new EditorTitleMenu(host.ownerDocument, this.#menus, {
      context: () => ({ editorMode: this.#views.mode, resource: this.#active }),
      executeCommand: (command) => this.commands.executeCommand(command),
    });
    this.#views.addTabActions(this.#editorTitle.element);
    this.#window = new WindowHost({
      host,
      statusBar: this.#layout.statusBar,
      editingArea: this.#layout.editor,
      activeTextEditor: () => this.#views.activeTextEditor,
      onDidChangeTextEditorSelection: this.#selectionChanged.event,
    });
    this.#preview = new Preview(this.#layout.preview);
    this.#subscription = project.onDidChangeFile((change) => this.#changed(change));
    this.#showDocumentLinks();
    this.#workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('workbench.theme')) this.#applyTheme();
    });
    this.#extensions = new ExtensionHost({
      project,
      commands: this.commands,
      window: this.#window,
      scm: this.#scm,
      languages: this.#languages,
      workspace: this.#workspace,
      workbench: this,
      visualView: this.#visualView,
      sourceView: this.#sourceViews,
      preview: this.#preview,
    });
  }

  /**
   * Declares the settings of `extensions`, activates them (in order), then shows the main file and compiles it. Once.
   * Values set for settings no one declares are reported (console) and ignored.
   */
  activate(extensions: readonly TypstExtension[]): void {
    for (const extension of extensions) this.#workspace.declare(extension.contributes?.configuration?.properties ?? {});
    this.#workspace.check();
    this.#extensions.activate(extensions);
    this.open(this.project.main);
    this.#compile();
  }

  get ownerDocument(): Document {
    return this.host.ownerDocument;
  }

  get activeFile(): ProjectPath {
    return this.#active;
  }

  get user(): User | undefined {
    return this.options.user;
  }

  /** The settings' values the host set, by full id. Assigning replaces them; listeners hear what changed. */
  get settings(): Settings {
    return this.#workspace.values;
  }

  set settings(settings: Settings) {
    this.#workspace.update(settings);
  }

  open(path: ProjectPath, options: OpenOptions = {}): void {
    if (!this.project.has(path)) return;
    const changed = path !== this.#active;
    this.#active = path;
    const document = this.project.document(path);
    this.#window.showCustomEditor(document ? null : { path, content: this.project.content(path)! }, options.viewType);
    this.#views.show(document ?? null);
    if (document && options.selection) this.#views.reveal(options.selection.from, options.selection.to, options.mode);
    this.#shown.fire(path);
    this.#editorTitle.update();
    if (changed) this.options.onOpen?.(path);
  }

  registerSidePanel(id: string, options: SidePanelOptions): SidePanel {
    return this.#layout.addPanel(id, options);
  }

  registerStyleSheet(css: string): Disposable {
    return this.#styleSheets.add(css);
  }

  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable {
    if (this.#hasFrame) throw new Error('There is an editor frame already');
    this.#hasFrame = true;
    this.#views.setFrame(frame);
    return new Disposable(() => {
      this.#hasFrame = false;
      this.#views.setFrame(null);
    });
  }

  remember<T>(name: string): Memory<T> {
    return this.#memory.remember<T>(name);
  }

  registerMenuItem(menuId: string, item: MenuItem): Disposable {
    return this.#menus.register(menuId, item);
  }

  getMenuItems(menuId: string, context?: MenuContext): readonly MenuItem[] {
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
    this.#views.dispose();
    this.#window.dispose();
    this.#scm.dispose();
    this.#editorTitle.dispose();
    this.#menus.dispose();
    this.#preview.dispose();
    this.commands.dispose();
    this.#workspace.dispose();
    this.#drops.dispose();
    for (const emitter of [this.#shown, this.#selectionChanged]) emitter.dispose();
    this.host.classList.remove('typst-editor');
    delete this.host.dataset.theme;
    this.#scheme.dispose();
    this.#layout.dispose();
    this.#ownStyles.dispose();
  }

  /** The Visual/Source views of every document, with the extensions' contributions. */
  #createViews(): EditingViews {
    return new EditingViews(this.#layout.editor, {
      mode: this.options.mode,
      visualView: this.#visualView,
      sourceViews: this.#sourceViews,
      // Fired from the editors' own updates: the DOM's selectionchange fires before
      // CodeMirror/ProseMirror read the new selection, so a listener would see the previous one.
      onSelection: (textEditor) => this.#selectionChanged.fire({ textEditor }),
      onMode: () => this.#editorTitle.update(),
    });
  }

  /** The registered document links in every Source view and in the code of every raw box (paths from its file's). */
  #showDocumentLinks(): void {
    const targets = { open: (path: ProjectPath) => this.open(path), executeCommand: (id: string, ...args: unknown[]) => this.commands.executeCommand(id, ...args) };
    const links = (document: TypstDocument) => this.#languages.editorExtension(targets, () => this.project.pathOf(document) ?? null);
    this.#sourceViews.registerExtension((view) => links(view.document));
    this.#visualView.registerBoxCodeExtension((view) => links(view.document));
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
    this.#views.retain(this.#documents());
    const active = this.#active;
    if (change.kind === 'rename' && change.from === active) this.open(change.path);
    else this.open(this.project.has(active) ? active : this.project.main);
  }

  #documents(): TypstDocument[] {
    return this.project.paths().flatMap((path) => this.project.document(path) ?? []);
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
} as const;
