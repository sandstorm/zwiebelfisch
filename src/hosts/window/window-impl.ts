// See WindowApi in window.ts.
import { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { SourceRange } from '../../core/typst-document/typst-document';
import { type CustomEditorChoice, CustomEditors } from './custom-editors/custom-editors';
import { FileDecorations } from './file-decorations/file-decorations';
import { ContextMenu } from './menus/context-menu';
import { Notifications } from './notifications/notifications';
import { ProgressIndicators } from './progress/progress';
import { QuickInput } from './quick-input/quick-input';
import { showSaveDialog } from './save-dialog/save-dialog';
import { StatusBar } from './status-bar/status-bar';
import css from './window.css?inline';
import type { WindowApi, MessageItem, InputBoxOptions, QuickPick, QuickPickItem, QuickPickOptions, SearchProvider, SaveDialogOptions, ContextMenuOptions, ProgressOptions, ProgressReport, Progress, StatusBarPlacement, FileDecoration, FileDecorationProvider, CustomEditorOptions, CustomEditorProvider, CustomDocument, TextEditor, TextEditorSelectionChangeEvent, WindowOptions } from './window';

/** The `WindowApi` of one widget. The workbench decides what is shown in the editing area (`showCustomEditor`). */
export class WindowHost implements WindowApi {
  readonly #notifications: Notifications;
  readonly #quickInput: QuickInput;
  readonly #contextMenu: ContextMenu;
  readonly #statusBar: StatusBar;
  readonly #progress: ProgressIndicators;
  readonly #customEditors: CustomEditors;
  readonly #fileDecorations = new FileDecorations();
  readonly #searchProviders = new Set<SearchProvider>();
  readonly #fileChanges: Disposable;
  readonly onDidChangeFileDecorations = this.#fileDecorations.onDidChange;
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  readonly onDidChangeActiveFile: Event<ProjectPath>;
  /** The CSS of messages, input boxes, quick picks, menus and custom editors' panels, for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(private readonly options: WindowOptions) {
    this.#notifications = new Notifications(options.host);
    this.#quickInput = new QuickInput(options.host);
    this.#contextMenu = new ContextMenu(options.host, { items: options.menuItems, executeCommand: options.executeCommand });
    this.#statusBar = new StatusBar(options.statusBar);
    this.#progress = new ProgressIndicators({ statusBar: this.#statusBar, editingArea: options.editingArea });
    this.#customEditors = new CustomEditors(options.editingArea);
    this.#fileChanges = options.onDidChangeFile((change) => this.#customEditors.followFileChange(change));
    this.onDidChangeTextEditorSelection = options.onDidChangeTextEditorSelection;
    this.onDidChangeActiveFile = options.onDidChangeActiveFile;
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

  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options: QuickPickOptions & { canPickMany: true }): Promise<T[] | undefined>;
  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options?: QuickPickOptions): Promise<T | undefined>;
  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options?: QuickPickOptions): Promise<T | T[] | undefined> {
    return this.#quickInput.showQuickPick(items, options);
  }

  createQuickPick<T extends QuickPickItem>(): QuickPick<T> {
    return this.#quickInput.createQuickPick<T>();
  }

  showSaveDialog(options?: SaveDialogOptions): Promise<ProjectPath | undefined> {
    return showSaveDialog((input) => this.showInputBox(input), (path) => this.options.exists(path), options);
  }

  showContextMenu(menuId: string, options: ContextMenuOptions): void {
    this.#contextMenu.show(menuId, options);
  }

  withProgress<R>(options: ProgressOptions, task: (progress: Progress<ProgressReport>) => Promise<R>): Promise<R> {
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

  /**
   * Shows `file` in its custom editor (`viewType` if it matches, else the one chosen last or the one its name picks)
   * in the editing area, revealing `selection` there; returns that editor's view type, undefined when none matches
   * (nothing is shown).
   */
  showCustomEditor(file: CustomDocument, viewType?: string, selection?: SourceRange): string | undefined {
    return this.#customEditors.show(file, viewType, selection);
  }

  /** The element of the custom editor's panel shown in the editing area; null while none is shown. */
  activeCustomEditorElement(): HTMLElement | null {
    return this.#customEditors.shownElement;
  }

  /** The editors `path` can be switched between (the tabs), best first. */
  customEditorChoices(path: ProjectPath): readonly CustomEditorChoice[] {
    return this.#customEditors.choicesFor(path);
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

  get activeFile(): ProjectPath {
    return this.options.activeFile();
  }

  get activeTextEditor(): TextEditor | null {
    return this.options.activeTextEditor();
  }

  dispose(): void {
    this.#searchProviders.clear();
    Disposable.from(this.#fileChanges, this.#notifications, this.#quickInput, this.#contextMenu, this.#progress, this.#customEditors, this.#fileDecorations).dispose();
  }
}
