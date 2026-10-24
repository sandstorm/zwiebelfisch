// See WindowApi in window.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange } from '../../core/project/project';
import type { User } from '../../core/user/user';
import type { CommandContribution, MenuItem } from '../commands/commands';
import { ColorScheme } from './color-scheme/color-scheme';
import { Editors } from './editors/editors';
import { FileDecorations } from './file-decorations/file-decorations';
import { FileDrops } from './file-drops/file-drops';
import { ItemBar } from './item-bar/item-bar';
import { EditorTabs } from './layout/editor-tabs';
import { WindowLayout } from './layout/window-layout';
import layoutCss from './layout/window-layout.css?inline';
import { ContextMenu } from './menus/context-menu';
import { Menus } from './menus/menus';
import { ViewMenu } from './menus/view-menu';
import { Notifications } from './notifications/notifications';
import { ProgressIndicators } from './progress/progress';
import { QuickInput } from './quick-input/quick-input';
import { showSaveDialog } from './save-dialog/save-dialog';
import { StyleSheets } from './style-sheets/style-sheets';
import css from './window.css?inline';
import type { WindowApi, MessageItem, MessageOptions, InputBoxOptions, QuickPick, QuickPickItem, QuickPickOptions, SearchProvider, SaveDialogOptions, ContextMenuOptions, ProgressOptions, StatusBarPlacement, TitleBarPlacement, FileDecoration, FileDecorationProvider, EditorProviderOptions, EditorProvider, TextEditor, TextEditorSelectionChangeEvent, DocumentShowOptions, SidePanel, SidePanelOptions, WindowOptions } from './window';

/**
 * The `WindowApi` of one widget on `options.host`: its regions (the title bar with "View", the sides with their panels,
 * the editing area with its tabs and editors, the status bar), menus, messages and input, the style sheets and the color scheme.
 * It shows the main file once `open` is first called and keeps the editing area on an existing file as files change.
 */
export class WindowHost implements WindowApi {
  #active: ProjectPath;
  /** The view type of the editor shown; undefined while none is. */
  #activeEditorId: string | undefined;
  #user: User | undefined;
  #headerFooter: { header: HTMLElement; footer: HTMLElement } | null = null;
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
  readonly #titleBar: ItemBar<TitleBarPlacement['alignment']>;
  readonly #statusBar: ItemBar<StatusBarPlacement['alignment']>;
  readonly #viewMenu: ViewMenu;
  readonly #progress: ProgressIndicators;
  readonly #editors: Editors;
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
      context: () => ({ activeEditorId: this.#activeEditorId, resource: this.#active }),
      commands,
    });
    this.#notifications = new Notifications(host);
    this.#quickInput = new QuickInput(host);
    this.#contextMenu = new ContextMenu(host, this.#menus, commands);
    this.#titleBar = new ItemBar(this.#layout.titleBar, ['left', 'center', 'right']);
    this.#statusBar = new ItemBar(this.#layout.statusBar, ['left', 'right']);
    this.#viewMenu = new ViewMenu(host.ownerDocument, this.#menus, {
      context: () => ({ activeEditorId: this.#activeEditorId, resource: this.#active }),
      showContextMenu: (menuId, menuOptions) => this.showContextMenu(menuId, menuOptions),
      place: (button) => this.registerTitleBarItem(button, { alignment: 'right', priority: VIEW_MENU_PRIORITY }),
    });
    this.#progress = new ProgressIndicators(this.#layout.editor);
    this.#editors = new Editors(this.#layout.editor);
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

  showInformationMessage<T extends string | MessageItem>(message: string, ...rest: (MessageOptions | T)[]): Promise<T | undefined> {
    return this.#notifications.show('info', message, ...optionsAndItems(rest));
  }

  showWarningMessage<T extends string | MessageItem>(message: string, ...rest: (MessageOptions | T)[]): Promise<T | undefined> {
    return this.#notifications.show('warning', message, ...optionsAndItems(rest));
  }

  showErrorMessage<T extends string | MessageItem>(message: string, ...rest: (MessageOptions | T)[]): Promise<T | undefined> {
    return this.#notifications.show('error', message, ...optionsAndItems(rest));
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

  registerTitleBarItem(element: HTMLElement, placement: TitleBarPlacement): Disposable {
    return this.#titleBar.add(element, placement);
  }

  registerEditorProvider(viewType: string, provider: EditorProvider, options: EditorProviderOptions): Disposable {
    return this.#editors.register(viewType, provider, options);
  }

  registerFileDecorationProvider(provider: FileDecorationProvider): Disposable {
    return this.#fileDecorations.register(provider);
  }

  getFileDecorations(path: ProjectPath): readonly FileDecoration[] {
    return this.#fileDecorations.decorationsOf(path);
  }

  getFileIcon(path: ProjectPath): string | undefined {
    return this.#editors.iconOf(path);
  }

  showDocument(path: ProjectPath, options: DocumentShowOptions = {}): void {
    const { project } = this.options;
    if (!project.has(path)) return;
    this.#active = path;
    this.#activeEditorId = this.#editors.show({ path, content: project.content(path)! }, options.viewType, options.selection);
    this.#tabs.update(this.#editors.choicesFor(path), this.#activeEditorId);
    this.#viewMenu.update();
    this.#placeHeaderFooter();
    this.#shown.fire(path);
  }

  get activeFile(): ProjectPath {
    return this.#active;
  }

  get activeTextEditor(): TextEditor | null {
    return this.#editors.shown?.textEditor ?? null;
  }

  isEditorFocused(): boolean {
    const area = this.#layout.editor;
    const root = area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && area.contains(root.activeElement);
  }

  registerSidePanel(id: string, options: SidePanelOptions): SidePanel {
    return this.#layout.addPanel(id, options);
  }

  registerEditorHeaderFooter(headerFooter: { header: HTMLElement; footer: HTMLElement }): Disposable {
    if (this.#headerFooter) throw new Error('There is an editor header and footer already');
    this.#headerFooter = headerFooter;
    this.#placeHeaderFooter();
    return new Disposable(() => {
      this.#headerFooter = null;
      headerFooter.header.remove();
      headerFooter.footer.remove();
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
    Disposable.from(this.#subscriptions, this.#notifications, this.#quickInput, this.#contextMenu, this.#progress, this.#editors, this.#fileDecorations, this.#tabs, this.#viewMenu, this.#menus, this.#drops).dispose();
    this.#shown.dispose();
    const { host } = this.options;
    host.classList.remove('zwf-editor');
    delete host.dataset.theme;
    this.#scheme.dispose();
    this.#layout.dispose();
    this.#ownStyles.dispose();
  }

  /** The editor header and footer in the shown panel around its `contentElement`, else around the panel; detached while none is shown. */
  #placeHeaderFooter(): void {
    if (!this.#headerFooter) return;
    const { header, footer } = this.#headerFooter;
    const panel = this.#editors.shown;
    if (!panel) {
      header.remove();
      footer.remove();
    } else if (panel.contentElement) {
      panel.element.insertBefore(header, panel.contentElement);
      panel.element.append(footer);
    } else {
      panel.element.before(header);
      panel.element.after(footer);
    }
  }

  /** Retained panels follow the change; after a create / rename / delete an existing file stays shown (a renamed file too). */
  #changed(change: FileChange): void {
    this.#editors.followFileChange(change);
    if (change.kind === 'update') return;
    const { project } = this.options;
    const active = this.#active;
    if (change.kind === 'rename' && change.from === active) this.showDocument(change.path);
    else this.showDocument(project.has(active) ? active : project.main);
  }

  /** The rail buttons of the menus `window/railLeft` and `window/railRight`, anew when `menuId` is one of them. */
  #showRailActions(menuId: string): void {
    const side = RAIL_SIDES.find((candidate) => menuId === RAIL_MENUS[candidate]);
    if (!side) return;
    const actions = this.#menus.items(menuId).map(({ command, title, icon, order }) => ({ command, title: title ?? command, icon: icon ?? '', order: order ?? 0 }));
    this.#layout.setRailActions(side, actions);
  }
}

/** Where "View" sits among the title bar's right items (higher further left): extensions place theirs around it. */
const VIEW_MENU_PRIORITY = 100;

/** A message's arguments after the text: VS Code's optional MessageOptions first (an object without `title`), then the items. */
function optionsAndItems<T extends string | MessageItem>(rest: readonly (MessageOptions | T)[]): [T[], MessageOptions] {
  const [first, ...others] = rest;
  const isOptions = typeof first === 'object' && first !== null && !('title' in first);
  return isOptions ? [others as T[], first as MessageOptions] : [rest as T[], {}];
}

/** The menu whose items each side's rail shows. */
const RAIL_MENUS = { left: 'window/railLeft', right: 'window/railRight' } as const;
const RAIL_SIDES = ['left', 'right'] as const;
