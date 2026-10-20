// See WindowApi in window.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange } from '../../core/project/project';
import type { User } from '../../core/user/user';
import type { CommandContribution, MenuItem } from '../commands/commands';
import { ColorScheme } from './color-scheme/color-scheme';
import { CustomEditors } from './custom-editors/custom-editors';
import { FileDecorations } from './file-decorations/file-decorations';
import { FileDrops } from './file-drops/file-drops';
import { EditorTabs } from './layout/editor-tabs';
import { WindowLayout } from './layout/window-layout';
import layoutCss from './layout/window-layout.css?inline';
import { ContextMenu } from './menus/context-menu';
import { Menus } from './menus/menus';
import { Notifications } from './notifications/notifications';
import { ProgressIndicators } from './progress/progress';
import { QuickInput } from './quick-input/quick-input';
import { showSaveDialog } from './save-dialog/save-dialog';
import { StatusBar } from './status-bar/status-bar';
import { StyleSheets } from './style-sheets/style-sheets';
import css from './window.css?inline';
import type { WindowApi, MessageItem, InputBoxOptions, QuickPick, QuickPickItem, QuickPickOptions, SearchProvider, SaveDialogOptions, ContextMenuOptions, ProgressOptions, StatusBarPlacement, FileDecoration, FileDecorationProvider, CustomEditorOptions, CustomEditorProvider, TextEditor, TextEditorSelectionChangeEvent, DocumentShowOptions, SidePanel, SidePanelOptions, WindowOptions } from './window';

/**
 * The `WindowApi` of one widget on `options.host`: its regions (the sides with their panels, the editing area with its
 * tabs and custom editors, the status bar), menus, messages and input, the style sheets and the color scheme.
 * It shows the main file once `open` is first called and keeps the editing area on an existing file as files change.
 */
export class WindowHost implements WindowApi {
  #active: ProjectPath;
  /** The view type of the custom editor shown; undefined while none is. */
  #activeCustomEditorId: string | undefined;
  #user: User | undefined;
  #frame: { top: HTMLElement; bottom: HTMLElement } | null = null;
  readonly #styleSheets: StyleSheets;
  readonly #ownStyles: Disposable;
  readonly #scheme: ColorScheme;
  readonly #layout: WindowLayout;
  readonly #drops: FileDrops;
  readonly #menus = new Menus();
  readonly #tabs: EditorTabs;
  readonly #notifications: Notifications;
  readonly #quickInput: QuickInput;
  readonly #contextMenu: ContextMenu;
  readonly #statusBar: StatusBar;
  readonly #progress: ProgressIndicators;
  readonly #customEditors: CustomEditors;
  readonly #fileDecorations = new FileDecorations();
  readonly #searchProviders = new Set<SearchProvider>();
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #subscriptions: Disposable;
  readonly onDidChangeFileDecorations = this.#fileDecorations.onDidChange;
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  readonly onDidChangeActiveFile = this.#shown.event;
  readonly onDidChangeMenu = this.#menus.onDidChange;
  readonly onDidDropFiles: Event<File[]>;

  constructor(private readonly options: WindowOptions) {
    const { host, project, commands } = options;
    this.#active = project.main;
    this.#styleSheets = new StyleSheets(host);
    this.#ownStyles = Disposable.from(this.#styleSheets.add((options.styleSheet ?? '') + layoutCss, 'zwf-editor-styles'), this.#styleSheets.add(css));
    host.classList.add('zwf-editor');
    this.#scheme = new ColorScheme(host);
    this.#layout = new WindowLayout(host, options.layoutState, commands);
    this.#drops = new FileDrops(host);
    this.onDidDropFiles = this.#drops.onDidDrop;
    this.onDidChangeTextEditorSelection = options.onDidChangeTextEditorSelection;
    this.#tabs = new EditorTabs(this.#layout.editor, this.#menus, {
      onDidChoose: (viewType) => this.showDocument(this.#active, { viewType }),
      context: () => ({ activeCustomEditorId: this.#activeCustomEditorId, resource: this.#active }),
      commands,
      showContextMenu: (menuId, menuOptions) => this.showContextMenu(menuId, menuOptions),
    });
    this.#notifications = new Notifications(host);
    this.#quickInput = new QuickInput(host);
    this.#contextMenu = new ContextMenu(host, this.#menus, commands);
    this.#statusBar = new StatusBar(this.#layout.statusBar);
    this.#progress = new ProgressIndicators(this.#layout.editor);
    this.#customEditors = new CustomEditors(this.#layout.editor);
    this.#subscriptions = Disposable.from(
      // retained panels follow a rename before the renamed file is shown again
      project.onDidChangeFile((change) => this.#changed(change)),
      this.#menus.onDidChange((menuId) => this.#showRailActions(menuId)),
    );
  }

  /** Declares commands (`contributes.commands`), whose title and icon menu entries registered later show by default. */
  declareCommands(commands: readonly CommandContribution[] | undefined): void {
    this.#menus.declareCommands(commands);
  }

  /** Shows the widget `light`, `dark`, `auto` (as the OS) or, null, as the page around it (CSS `color-scheme`): `data-theme`, and `data-scheme` as the colors resolve now. */
  setTheme(theme: 'light' | 'dark' | 'auto' | null): void {
    const { host } = this.options;
    if (theme) host.dataset.theme = theme;
    else delete host.dataset.theme;
    this.#scheme.update();
  }

  /** The panel the right side shows until the viewer picks one with its rail (null: it starts hidden), before the panels' own `setDefault`. */
  setDefaultSidePanel(id: string | null): void {
    this.#layout.setDefaultPanel('right', id);
  }

  get ownerDocument(): Document {
    return this.options.host.ownerDocument;
  }

  get user(): User | undefined {
    return this.#user ?? this.options.user;
  }

  setUser(user: User): void {
    this.#user = user;
  }

  showInformationMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return this.#notifications.show('info', message, items);
  }

  showWarningMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return this.#notifications.show('warning', message, items);
  }

  showErrorMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined> {
    return this.#notifications.show('error', message, items);
  }

  showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
    return this.#quickInput.showInputBox(options);
  }

  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options?: QuickPickOptions): Promise<T | undefined> {
    return this.#quickInput.showQuickPick(items, options);
  }

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return this.#quickInput.createQuickPick<T>();
  }

  showSaveDialog(options?: SaveDialogOptions): Promise<ProjectPath | undefined> {
    return showSaveDialog((input) => this.showInputBox(input), (path) => this.options.project.has(path), options);
  }

  showContextMenu(menuId: string, options: ContextMenuOptions): void {
    this.#contextMenu.show(menuId, options);
  }

  withProgress<R>(options: ProgressOptions, task: () => Promise<R>): Promise<R> {
    return this.#progress.run(options, task);
  }

  registerSearchProvider(provider: SearchProvider): Disposable {
    if (this.getSearchProviders().some((other) => other.id === provider.id)) throw new Error(`There is a search provider ${provider.id} already`);
    this.#searchProviders.add(provider);
    return new Disposable(() => this.#searchProviders.delete(provider));
  }

  getSearchProviders(): readonly SearchProvider[] {
    return [...this.#searchProviders];
  }

  registerStatusBarItem(element: HTMLElement, placement: StatusBarPlacement): Disposable {
    return this.#statusBar.add(element, placement);
  }

  registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable {
    return this.#customEditors.register(viewType, provider, options);
  }

  registerFileDecorationProvider(provider: FileDecorationProvider): Disposable {
    return this.#fileDecorations.register(provider);
  }

  getFileDecorations(path: ProjectPath): readonly FileDecoration[] {
    return this.#fileDecorations.decorationsOf(path);
  }

  getFileIcon(path: ProjectPath): string | undefined {
    return this.#customEditors.iconOf(path);
  }

  showDocument(path: ProjectPath, options: DocumentShowOptions = {}): void {
    const { project } = this.options;
    if (!project.has(path)) return;
    this.#active = path;
    this.#activeCustomEditorId = this.#customEditors.show({ path, content: project.content(path)! }, options.viewType, options.selection);
    this.#tabs.update(this.#customEditors.choicesFor(path), this.#activeCustomEditorId);
    this.#placeFrame();
    this.#shown.fire(path);
  }

  get activeFile(): ProjectPath {
    return this.#active;
  }

  get activeTextEditor(): TextEditor | null {
    return this.#customEditors.shown?.textEditor ?? null;
  }

  isEditorFocused(): boolean {
    const area = this.#layout.editor;
    const root = area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && area.contains(root.activeElement);
  }

  registerSidePanel(id: string, options: SidePanelOptions): SidePanel {
    return this.#layout.addPanel(id, options);
  }

  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable {
    if (this.#frame) throw new Error('There is an editor frame already');
    this.#frame = frame;
    this.#placeFrame();
    return new Disposable(() => {
      this.#frame = null;
      frame.top.remove();
      frame.bottom.remove();
    });
  }

  registerStyleSheet(css: string): Disposable {
    return this.#styleSheets.add(css);
  }

  registerMenuItem<C extends object>(menuId: string, item: MenuItem<C>): Disposable {
    return this.#menus.register(menuId, item);
  }

  getMenuItems<C extends object>(menuId: string, context?: C): readonly MenuItem<C>[] {
    return this.#menus.items(menuId, context);
  }

  dispose(): void {
    this.#searchProviders.clear();
    Disposable.from(this.#subscriptions, this.#notifications, this.#quickInput, this.#contextMenu, this.#progress, this.#customEditors, this.#fileDecorations, this.#tabs, this.#menus, this.#drops).dispose();
    this.#shown.dispose();
    const { host } = this.options;
    host.classList.remove('zwf-editor');
    delete host.dataset.theme;
    this.#scheme.dispose();
    this.#layout.dispose();
    this.#ownStyles.dispose();
  }

  /** The editor frame in the shown panel around its `contentElement`, else around the panel; detached while none is shown. */
  #placeFrame(): void {
    if (!this.#frame) return;
    const { top, bottom } = this.#frame;
    const panel = this.#customEditors.shown;
    if (!panel) {
      top.remove();
      bottom.remove();
    } else if (panel.contentElement) {
      panel.element.insertBefore(top, panel.contentElement);
      panel.element.append(bottom);
    } else {
      panel.element.before(top);
      panel.element.after(bottom);
    }
  }

  /** Retained panels follow the change; after a create / rename / delete an existing file stays shown (a renamed file too). */
  #changed(change: FileChange): void {
    this.#customEditors.followFileChange(change);
    if (change.kind === 'update') return;
    const { project } = this.options;
    const active = this.#active;
    if (change.kind === 'rename' && change.from === active) this.showDocument(change.path);
    else this.showDocument(project.has(active) ? active : project.main);
  }

  /** The rail buttons of the menus `workbench/rail/left` and `workbench/rail/right`, anew when `menuId` is one of them. */
  #showRailActions(menuId: string): void {
    const side = RAIL_MENUS.find((candidate) => menuId === `workbench/rail/${candidate}`);
    if (!side) return;
    const actions = this.#menus.items(menuId).map(({ command, title, icon, order }) => ({ command, title: title ?? command, icon: icon ?? '', order: order ?? 0 }));
    this.#layout.setRailActions(side, actions);
  }
}

/** The sides whose rail shows a menu's items (`workbench/rail/<side>`). */
const RAIL_MENUS = ['left', 'right'] as const;
