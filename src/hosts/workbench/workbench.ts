// The workbench host: the widget's frame (side panels on the left and the right, the preview being the right side's
// built-in one; the editing area with its custom editors and the tabs between them; the status bar), the extension API every feature uses to put itself into it, and the composition of the
// other hosts. Entry of hosts/workbench/.
// Why extensions: the frame knows no feature by name. A feature is a `TypstExtension` that registers what it adds
// (a side panel, a custom editor, a command, a menu item, a link provider, a source control) once, at activation, and the
// host disposes all of it on dispose. Even the Typst files' Visual and Source views are custom editors (registered
// here, before the extensions), so the editing area treats every file alike. The API is VS Code's namespaces, each a host of its own (`commands`, `window`,
// `scm`, `languages`, `workspace`); `workbench` is only the frame. Adding a feature is adding it to a list, not
// editing the frame. Extensions never depend on each other: what one offers another goes through a generic
// contribution point of a host.
// See docs/30_architecture/07_workbench.typ.
// WorkbenchHost (below the API) is what createTypstEditor creates; extensions see it as `Workbench`.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import type { User } from '../../core/user/user';
import { type Commands, CommandsHost } from '../commands/commands';
import { type Languages, LanguagesHost } from '../languages/languages';
import { Preview, type PreviewContributions, type PreviewProgress } from '../preview/preview';
import { type Scm, ScmHost } from '../scm/scm';
import { SourceViewHost, type SourceViewContributions } from '../source-view/source-view';
import { VisualViewHost, type VisualViewContributions } from '../visual-view/visual-view';
import { type EditorMode, ProgressLocation, type TextEditorSelectionChangeEvent, type WindowApi, WindowHost } from '../window/window';
import { type ConfigurationProperty, type Settings, type Workspace, WorkspaceHost } from '../workspace/workspace';
import { ColorScheme } from './color-scheme/color-scheme';
import { EditorTabs } from './editor-tabs/editor-tabs';
import { ExtensionHost } from './extension-host/extension-host';
import { FileDrops } from './file-drops/file-drops';
import { WorkbenchLayout } from './layout/workbench-layout';
import { EditorTitleMenu } from './menus/editor-title-menu';
import { Menus } from './menus/menus';
import { StorageMemento } from './memento/memento';
import { StyleSheets } from './style-sheets/style-sheets';
import { TypstEditors, VIEW_TYPES } from './typst-editors/typst-editors';
import css from './workbench.css?inline';

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
  /**
   * Values the extension keeps for this viewer across widgets and visits (VS Code's `globalState`: the browser's
   * local storage), apart from other extensions' (by `id`). E.g. a viewer's preference.
   */
  readonly globalState: Memento;
  /**
   * Values the extension keeps for this widget's project during the browser session (VS Code's `workspaceState`:
   * the session storage, under the main file's path), apart from other extensions'. E.g. which folders are open.
   */
  readonly workspaceState: Memento;
  /** Commands by id and their key bindings (VS Code's `commands` namespace). */
  readonly commands: Commands;
  /** Messages, input box, quick pick, status bar items, custom editors, file decorations, the active editor (VS Code's `window`). */
  readonly window: WindowApi;
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

/** The widget's frame as extensions see it: showing files, and the places of the frame they can put things. */
export interface Workbench {
  /** The document the widget lives in, to create elements for it. */
  readonly ownerDocument: Document;
  /** Who works in the widget, as the host said (`createTypstEditor({ user })`); undefined: anonymous. */
  readonly user: User | undefined;
  /**
   * Shows `path` in the editing area (if the project has it), in a custom editor (`window.registerCustomEditorProvider`;
   * a Typst file's are the Visual and the Source view): the one `viewType` names, else the one the user chose last,
   * else the default one; nothing without one. Opening the shown file again shows it again (an editor without
   * `retainContextWhenHidden` gets the current content in a new panel). `selection` reveals a range of a Typst file.
   */
  open(path: ProjectPath, options?: OpenOptions): void;

  /**
   * Adds `css` where the widget renders (the page's `<head>`, or the shadow root of a `<typst-editor>`), after the
   * widget's own stylesheet, until disposed. An extension styles what it adds this way, under class names of its own,
   * with the colors of the `--te-*` tokens (light and dark). Widgets in one root share each stylesheet.
   */
  registerStyleSheet(css: string): Disposable;
  /**
   * Adds a side panel with its rail button on `options.side` (one panel per side is shown at a time); disposing removes
   * both. Ids are unique across both sides; the right side has the preview (`preview`) built in.
   */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /**
   * Shows `top` right before and `bottom` right after the shown file's editor, across tab and file switches: in a
   * Typst file's view inside its content (in the Visual view below its toolbar), scrolling with it; around any other
   * editor's panel, not scrolling. Detached while no editor is shown. One frame at a time.
   */
  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget (and not taken by a view inside, such as the Visual view
   * taking images). The widget never lets the browser open a dropped file; it shows the drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;

  /**
   * Adds `item` to the menu `menuId` until disposed (VS Code's `contributes.menus`). Whoever shows a menu renders
   * the items whose `when` holds there, sorted by `group` and `order`, and runs an item's command with the menu's
   * arguments. The workbench shows `editor/title`: the editing area's tab bar, while the shown file has several
   * editors (context: `editorMode` (the Typst view shown, else undefined), `resource` (the shown file); no
   * arguments). Other ids are menus of views that extensions show, documented there (the file panel: `file/newFile`,
   * `explorer/context`).
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
  /** A range of the Typst file to reveal. */
  selection?: SourceRange;
  /**
   * The custom editor to open the file in, if it matches the file (its view type, e.g. `sourceView.editor`); it is
   * then the user's choice for later opens, too. Default: the one chosen last, else the one its name picks.
   */
  viewType?: string;
}

export interface SidePanelOptions {
  /** Shown on the rail button (as its tooltip and accessible name). */
  label: string;
  /** The rail button's icon. */
  icon: Element;
  /** The side whose rail gets the button; default `'left'`. */
  side?: 'left' | 'right';
  /** The rail button's place among the others of its side (lower first; equal: registration order); default 0. */
  order?: number;
}

/** A registered side panel: the element its content goes into, and how it opens. */
export interface SidePanel {
  readonly body: HTMLElement;
  /**
   * Shows it by default: unless the viewer picked a panel of its side (or hid the side) this session, the side names
   * another default (the right side's: the setting `workbench.rightSidePanel`), or the widget is narrow (left side).
   */
  setDefault(open: boolean): void;
  /** Shows or removes it and its rail button altogether (e.g. the setting `files.panel: 'hide'`). */
  setAvailable(available: boolean): void;
  /** Closes it if it lies over the editing area (narrow widget, left side), e.g. after something was chosen in it. */
  dismiss(): void;
  dispose(): void;
}

/**
 * Values kept by key (VS Code's Memento), as JSON: what `get` gives is what was stored, so read it as data from
 * outside (check its shape). Without storage (blocked, private window) nothing is kept and nothing fails.
 */
export interface Memento {
  /** The keys that have a value. */
  keys(): readonly string[];
  /** The value stored under `key`, else `defaultValue`. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Stores `value` (JSON-like) under `key`; `undefined` removes it. */
  update(key: string, value: unknown): Promise<void>;
}

/**
 * The drag data type (`DataTransfer`) of a project file dragged inside the widget, e.g. a row of the file panel; the
 * data is its path. Any view may take such a drop (the Visual view inserts a dragged image).
 */
export const PROJECT_PATH_TYPE = 'application/x-typst-project-path';

export interface WorkbenchOptions {
  /** The view Typst files open in until the user chooses the other one (default: visual). */
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
   * The widget's color tokens and frame (CSS), put where it renders before the frame is built (the color scheme reads
   * the resolved colors), as `<style id="typst-editor-styles">` together with the workbench's own CSS. The other
   * hosts' stylesheets follow it, then the extensions'.
   */
  styleSheet?: string;
}

/**
 * The frame of the widget on `host`: shows the project's files in custom editors (Typst files in the Visual and the
 * Source view, others in those extensions register, tabs between them), keeps the preview compiling the main file, and runs the extensions. It
 * makes the other hosts: VS Code's namespaces (`commands`, `window`, `scm`, `languages`, `workspace`) and the views'
 * (`visualView`, `sourceView`, `preview`). `activate` starts it: extensions first (their contributions are in place
 * before any view exists), then the main file is shown and compiled.
 */
export class WorkbenchHost implements Workbench {
  #active: ProjectPath;
  /** The commands, for the widget's `executeCommand`. */
  readonly commands: CommandsHost;
  readonly #layout: WorkbenchLayout;
  readonly #typstEditors: TypstEditors;
  readonly #tabs: EditorTabs;
  /** The window, for the widget's `activeFile`. */
  readonly window: WindowHost;
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
  readonly #visualView = new VisualViewHost();
  readonly #sourceViews = new SourceViewHost();
  readonly #preview: Preview;
  /** The status bar entry of what the preview loads (`#showPreviewProgress`), while it loads something. */
  #previewProgress: { report(message: string): void; done(): void } | null = null;
  #previewFailed = false;
  #frame: { top: HTMLElement; bottom: HTMLElement } | null = null;
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #selectionChanged = new EventEmitter<TextEditorSelectionChangeEvent>();
  readonly #subscription: Disposable;

  readonly onDidDropFiles: Event<File[]>;
  readonly onDidChangeMenu = this.#menus.onDidChange;

  constructor(
    private readonly host: HTMLElement,
    private readonly project: Project,
    private readonly options: WorkbenchOptions = {},
  ) {
    this.#active = project.main;
    this.#styleSheets = new StyleSheets(host);
    const frameStyles = this.#styleSheets.add((options.styleSheet ?? '') + css, 'typst-editor-styles');
    host.classList.add('typst-editor');
    this.#workspace = new WorkspaceHost(project, { settings: options.settings, allowFileChange: options.allowFileChange });
    this.#workspace.declare(WORKBENCH_SETTINGS);
    this.#scheme = new ColorScheme(host);
    this.#applyTheme();
    const doc = host.ownerDocument;
    this.#layout = new WorkbenchLayout(host, StorageMemento.of(doc, 'sessionStorage', `typst-editor:${project.main}:workbench:`));
    this.commands = new CommandsHost(host);
    this.#drops = new FileDrops(host);
    this.onDidDropFiles = this.#drops.onDidDrop;
    this.#editorTitle = new EditorTitleMenu(host.ownerDocument, this.#menus, {
      context: () => ({ editorMode: this.#typstEditors.activeTextEditor?.mode, resource: this.#active }),
      executeCommand: (command) => this.commands.executeCommand(command),
    });
    this.#tabs = new EditorTabs(doc, this.#editorTitle.element, (viewType) => this.open(this.#active, { viewType }));
    this.#layout.editor.append(this.#tabs.element);
    this.#typstEditors = new TypstEditors(project, {
      visualView: this.#visualView,
      sourceViews: this.#sourceViews,
      // Fired from the editors' own updates: the DOM's selectionchange fires before
      // CodeMirror/ProseMirror read the new selection, so a listener would see the previous one.
      onSelection: (textEditor) => this.#selectionChanged.fire({ textEditor }),
    });
    this.window = this.#createWindow();
    this.#preview = this.#createPreview();
    // the hosts' CSS after the tokens and the frame, before the extensions'
    const hosts = [this.window, this.#languages, this.#preview, this.#sourceViews, this.#visualView];
    this.#ownStyles = Disposable.from(frameStyles, ...hosts.map((part) => this.#styleSheets.add(part.styleSheet)));
    this.#subscription = project.onDidChangeFile((change) => this.#changed(change));
    this.#showDocumentLinks();
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
        visualView: this.#visualView,
        sourceView: this.#sourceViews,
        preview: this.#preview,
      },
      (id) => ({
        globalState: StorageMemento.of(doc, 'localStorage', `typst-editor:global:${id}:`),
        workspaceState: StorageMemento.of(doc, 'sessionStorage', `typst-editor:${project.main}:${id}:`),
      }),
    );
  }

  /**
   * Declares the settings of `extensions`, activates them (in order), then shows the main file and compiles it. Once.
   * Values set for settings no one declares are reported (console) and ignored.
   */
  activate(extensions: readonly TypstExtension[]): void {
    for (const extension of extensions) this.#workspace.declare(extension.contributes?.configuration?.properties ?? {});
    this.#workspace.check();
    this.#extensions.activate(extensions);
    this.open(this.project.main, { viewType: this.options.mode && VIEW_TYPES[this.options.mode] });
    this.#compile();
  }

  get ownerDocument(): Document {
    return this.host.ownerDocument;
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
    const viewType = this.window.showCustomEditor({ path, content: this.project.content(path)! }, options.viewType);
    if (options.selection) this.#typstEditors.activeTextEditor?.revealRange(options.selection);
    this.#tabs.update(this.window.customEditorChoices(path), viewType);
    this.#placeFrame();
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
    if (this.#frame) throw new Error('There is an editor frame already');
    this.#frame = frame;
    this.#typstEditors.setFrame(frame);
    this.#placeFrame();
    return new Disposable(() => {
      this.#frame = null;
      this.#typstEditors.setFrame(null);
      frame.top.remove();
      frame.bottom.remove();
    });
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
    this.window.dispose();
    this.#tabs.dispose();
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

  /**
   * The window, its editing area showing Typst files in the Visual and Source views: registered first, they win ties
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
      activeTextEditor: () => this.#typstEditors.activeTextEditor,
      onDidChangeTextEditorSelection: this.#selectionChanged.event,
    });
    this.#typstEditors.register(window);
    return window;
  }

  /**
   * The preview, in the right side's built-in panel `preview` (registered before any extension, so first among equal
   * orders). It compiles whether shown or not: diagnostics, raw box snippets and the selection highlight never wait
   * for it to be shown.
   */
  #createPreview(): Preview {
    const panel = this.#layout.addPanel('preview', { label: 'Preview', icon: previewIcon(this.host.ownerDocument), side: 'right' });
    return new Preview(panel.body, { onDidChangeProgress: (progress) => this.#showPreviewProgress(progress) });
  }

  /**
   * What the preview loads, in the status bar too (it may be hidden, and its pane shows it only until the first
   * pages): the compiler's download, packages, fonts. Not the first compile: the compile status says that. A compiler
   * that cannot be loaded is an error message.
   */
  #showPreviewProgress(progress: PreviewProgress | null): void {
    const failed = progress?.kind === 'failed';
    if (failed && !this.#previewFailed) void this.window.showErrorMessage(`${progress.title} ${progress.detail ?? ''}`.trim());
    this.#previewFailed = failed;
    const message = statusBarMessage(progress);
    if (message === null) {
      this.#previewProgress?.done();
      this.#previewProgress = null;
      return;
    }
    this.#previewProgress ??= this.#startProgress();
    this.#previewProgress.report(message);
  }

  /** A status bar progress entry, reported to and ended from outside (`window.withProgress` runs a task). */
  #startProgress(): { report(message: string): void; done(): void } {
    const entry = { report: (_message: string) => {}, done: () => {} };
    void this.window.withProgress({ location: ProgressLocation.Window }, (progress) => {
      entry.report = (message) => progress.report({ message });
      return new Promise<void>((resolve) => (entry.done = resolve));
    });
    return entry;
  }

  /**
   * The editor frame around the shown custom editor's panel, unless a Typst view is shown (TypstEditors puts it into
   * the view's scrolling content then).
   */
  #placeFrame(): void {
    if (!this.#frame || this.#typstEditors.activeTextEditor) return;
    const panel = this.window.activeCustomEditorElement();
    if (panel) {
      panel.before(this.#frame.top);
      panel.after(this.#frame.bottom);
    } else {
      this.#frame.top.remove();
      this.#frame.bottom.remove();
    }
  }

  /** The right side's default panel from the setting `workbench.rightSidePanel`. */
  #applyRightSidePanel(): void {
    this.#layout.setDefaultPanel('right', this.#workspace.getConfiguration('workbench').get<string | null>('rightSidePanel'));
  }

  /** The registered document links in every Source view and in the code of every raw box (paths from its file's). */
  #showDocumentLinks(): void {
    const targets = { open: (path: ProjectPath) => this.open(path), executeCommand: (id: string, ...args: unknown[]) => this.commands.executeCommand(id, ...args) };
    const links = (document: TypstDocument) => this.#languages.codeMirrorExtension(targets, () => this.project.pathOf(document) ?? null);
    this.#sourceViews.registerCodeMirrorExtension((view) => links(view.document));
    this.#visualView.registerRawBoxCodeMirrorExtension((view) => links(view.document));
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

/** What of the preview's progress the status bar shows: not the first compile (the compile status says that), nor a failure. */
function statusBarMessage(progress: PreviewProgress | null): string | null {
  if (!progress || progress.kind === 'compiling' || progress.kind === 'failed') return null;
  return [progress.title, progress.detail].filter(Boolean).join(' ');
}

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
