// The window namespace of the extension API (VS Code's `window`): what every feature needs to talk to the user
// (messages, input box, quick pick), and the places of the widget's window a feature puts things into (status bar
// items, custom editors, file decorations), and the file and editor the user works in. Entry of
// hosts/window/. See docs/architecture/workbench.typ.
// Why one namespace in VS Code's shapes: features look and behave alike when they ask and tell the same way, and
// they never make popovers of their own. The parts (notifications/, quick-input/, status-bar/, custom-editors/,
// file-decorations/) are deep modules of their own; WindowHost puts them where the workbench's frame says.
import { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent } from '../../core/project/project';
import type { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { type CustomEditorChoice, CustomEditors } from './custom-editors/custom-editors';
import { FileDecorations } from './file-decorations/file-decorations';
import { Notifications } from './notifications/notifications';
import { QuickInput } from './quick-input/quick-input';
import { showSaveDialog } from './save-dialog/save-dialog';
import { StatusBar } from './status-bar/status-bar';
import css from './window.css?inline';

/** The widget's window as extensions use it (VS Code's `window` namespace). */
export interface WindowApi {
  /**
   * Shows `message` in the widget's notification area (VS Code's `window.showInformationMessage`), with a button per
   * item. Resolves to the item chosen, or undefined once it is closed (an information message without items closes
   * by itself after a while). Not modal: the user goes on working meanwhile.
   */
  showInformationMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined>;
  /** As `showInformationMessage`, as a warning (stays until closed). */
  showWarningMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined>;
  /** As `showInformationMessage`, as an error (stays until closed). */
  showErrorMessage<T extends string | MessageItem>(message: string, ...items: T[]): Promise<T | undefined>;
  /**
   * Asks for one line of text (VS Code's `window.showInputBox`), below what the user just used (a button, a row),
   * or at the selection when they work in an editor. Resolves to the text on Enter / OK, undefined on Escape or a
   * click elsewhere. One at a time: a new input box or quick pick cancels the open one.
   */
  showInputBox(options?: InputBoxOptions): Promise<string | undefined>;
  /**
   * Lets the user pick one of `items` (VS Code's `window.showQuickPick`), filtered as they type, placed as
   * `showInputBox`. Resolves to the item picked, undefined when cancelled; with `canPickMany`, to the items checked.
   */
  showQuickPick<T extends string | QuickPickItem>(
    items: readonly T[] | Promise<readonly T[]>,
    options: QuickPickOptions & { canPickMany: true },
  ): Promise<T[] | undefined>;
  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options?: QuickPickOptions): Promise<T | undefined>;
  /**
   * Asks where a new file goes (VS Code's `window.showSaveDialog`, as an input box placed as `showInputBox`): a name,
   * starting in the folder of `defaultUri`, with the first `filters` ending added to a name without one. A name
   * without one of the endings, or of a file the project has, is refused. Resolves to the path, or undefined when
   * cancelled; creating the file is the caller's (`workspace.applyEdit`).
   */
  showSaveDialog(options?: SaveDialogOptions): Promise<ProjectPath | undefined>;

  /**
   * Puts `element` into the status bar below everything, until disposed: on the side `placement.alignment` says, the
   * higher `placement.priority` further left within it (VS Code's StatusBarItem).
   */
  registerStatusBarItem(element: HTMLElement, placement: StatusBarPlacement): Disposable;
  /**
   * Opens files whose name matches `options.filenamePattern` in the editor `provider` puts into a panel of the editing
   * area, until disposed (VS Code's custom editors; the Typst files' Visual and Source views are two of them,
   * `visualView.editor` and `sourceView.editor`). `viewType` names the editor (`<extension>.<name>`, unique), e.g. for
   * `workbench.open(path, { viewType })`. When several match a file, the editing area's tabs switch between them
   * (`displayName`), and the one the user chose last opens it; before any choice, the one of the highest `priority`
   * (`'default'`: 100; `'option'`: only when chosen), then the most specific pattern (`*.drawio.png` over `*.png`),
   * then the one registered first.
   */
  registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable;

  /**
   * Adds decorations to files (badges on their rows in the views that list files, such as other users' initials)
   * until disposed. Several providers may decorate the same file; their decorations are shown in registration order.
   */
  registerFileDecorationProvider(provider: FileDecorationProvider): Disposable;
  /** The decorations of `path` from every provider, for a view that lists files. */
  getFileDecorations(path: ProjectPath): readonly FileDecoration[];
  /** Decorations changed: of these files, or of any (undefined). */
  readonly onDidChangeFileDecorations: Event<readonly ProjectPath[] | undefined>;
  /**
   * The icon of `path` for a view that lists files: that of the custom editor opening it by default (its `icon`);
   * undefined when it has none, or no custom editor opens it (a Typst file).
   */
  getFileIcon(path: ProjectPath): string | undefined;

  /** The file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /** After a file was shown in the editing area (also when the same file is shown again). */
  readonly onDidChangeActiveFile: Event<ProjectPath>;
  /** The editor of the Typst file shown in the editing area; null while another kind of file is shown. */
  readonly activeTextEditor: TextEditor | null;
  /**
   * The selection in an editor moved, or its text changed (fired from the views' own updates, so `selection` is
   * the new one already). Any document's editor, not only the active one: a hidden view follows the text, too.
   */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
}

/** A button of a message (VS Code's MessageItem); the message resolves to the one chosen. */
export interface MessageItem {
  readonly title: string;
}

/** How serious a message is. */
export type MessageSeverity = 'info' | 'warning' | 'error';

/** What `showInputBox` asks (VS Code's InputBoxOptions). */
export interface InputBoxOptions {
  /** Above the field: what is being done ("Link"). The box's accessible name. */
  title?: string;
  /** The text the field starts with. */
  value?: string;
  /** The part of `value` selected at first, as [start, end) offsets; default: all of it. */
  valueSelection?: readonly [number, number];
  /** What to enter: the field's label, below it. */
  prompt?: string;
  /** Shown in the empty field. */
  placeHolder?: string;
  /**
   * Checks the text as it is typed and on Enter: a message says what is wrong (and Enter does nothing); undefined,
   * null or '' that it is fine. May be async.
   */
  validateInput?(value: string): string | undefined | null | Promise<string | undefined | null>;
}

/** An item of `showQuickPick` (VS Code's QuickPickItem). */
export interface QuickPickItem {
  /** What the item is called; typing filters by it. */
  readonly label: string;
  /** Less prominent, after the label. */
  readonly description?: string;
  /** Less prominent, on a line of its own. */
  readonly detail?: string;
  /** Checked at first (with `canPickMany`). */
  readonly picked?: boolean;
}

/** How `showQuickPick` asks (VS Code's QuickPickOptions). */
export interface QuickPickOptions {
  /** Above the list: what is being picked. The box's accessible name. */
  title?: string;
  /** Shown in the empty filter field: what to do. */
  placeHolder?: string;
  /** Checkboxes and OK instead of picking one; resolves to the checked items. */
  canPickMany?: boolean;
}

/** What `showSaveDialog` asks (VS Code's SaveDialogOptions). */
export interface SaveDialogOptions {
  /** Above the field: what is being made ("New diagram"). The box's accessible name; default "Save". */
  title?: string;
  /** Where the name starts: the folder of this file, or this folder (default: the top of the project). */
  defaultUri?: ProjectPath;
  /**
   * The endings a name may have, by what they are (without the dot, e.g. `{ Diagrams: ['drawio.png'] }`); `'*'`
   * allows any (`{ 'All files': ['*'] }`). The first one is added to a name without an ending. Default: any, none added.
   */
  filters?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Where a status bar item goes, as VS Code's `StatusBarItem`: `left` items from the bar's start, `right` items at its
 * end; within a side the higher `priority` further left (default 0), equal priorities in registration order.
 */
export interface StatusBarPlacement {
  readonly alignment: 'left' | 'right';
  readonly priority?: number;
}

/** How a view that lists files marks one (VS Code's FileDecoration): a small badge with a tooltip. */
export interface FileDecoration {
  /** A short text drawn as a badge (one or two characters, e.g. initials). */
  readonly badge?: string;
  /** What the decoration means (the badge's tooltip and accessible name). */
  readonly tooltip?: string;
  /** The CSS color the badge is drawn in (text on it is black or white, whichever reads better). */
  readonly color?: string;
  /** Also shown on the folders around the file while they are closed. */
  readonly propagate?: boolean;
}

/** Gives files decorations (VS Code's FileDecorationProvider; one file may get several here). */
export interface FileDecorationProvider {
  /** The decorations of `path` now. */
  provideFileDecoration(path: ProjectPath): FileDecoration | readonly FileDecoration[] | undefined;
  /** Fires when decorations changed: of these files, or of any (undefined). */
  readonly onDidChangeFileDecorations: Event<readonly ProjectPath[] | undefined>;
}

/**
 * Where a custom editor opens files (VS Code: the `selector`, `priority` and `displayName` of
 * `contributes.customEditors`) and how its panels live.
 */
export interface CustomEditorOptions {
  /** What the editor is called: its tab, when a file can be shown in several editors ("Visual", "Diagram"). */
  readonly displayName: string;
  /**
   * The files it opens, as a glob over the file name: `*` (any characters but `/`), `**`, `?`, `{a,b}`, e.g.
   * `*.drawio.png`, `*.{png,jpg}`; with a `/` over the path from the project root (`diagrams/*.png`). Case-insensitive.
   */
  readonly filenamePattern: string;
  /**
   * Who opens a file several editors match: a number (higher first), `'default'` (100, the default) or `'option'`
   * (never by default, only when chosen: a tab, `workbench.open(path, { viewType })`). Below 100: a fallback, which
   * opens only files nothing else matches and gets no tab.
   */
  readonly priority?: 'default' | 'option' | number;
  /**
   * The icon of the files it opens by default, where views list files (the file panel): SVG markup with a 16×16 view
   * box, drawn in strokes of `currentColor`.
   */
  readonly icon?: string;
  /**
   * Keeps a file's panel while another file (or editor) is shown, hidden, and shows it again when the file opens in
   * this editor again (VS Code's `retainContextWhenHidden`); disposed when the file is deleted. Default: every open
   * gets a new panel.
   */
  readonly retainContextWhenHidden?: boolean;
}

/** Shows (and edits) files in the editing area (VS Code's CustomReadonlyEditorProvider, without documents of its own). */
export interface CustomEditorProvider {
  /**
   * Fills `panel` with the editor of `document`: called whenever such a file is opened, each time with a new panel.
   * The editor stores what it changes through `workspace.applyEdit` (an `update` with the new content).
   */
  resolveCustomEditor(document: CustomDocument, panel: CustomEditorPanel): void;
}

/** The file a custom editor opens: where it is, and its content when it was opened. */
export interface CustomDocument {
  readonly path: ProjectPath;
  readonly content: FileContent;
}

/** Where a custom editor shows one opened file (VS Code's WebviewPanel, with an element instead of a webview). */
export interface CustomEditorPanel {
  /** The editor's place in the editing area (a flex column filling it); removed once the panel is disposed. */
  readonly element: HTMLElement;
  /** Whether the panel is shown (false while hidden; only with `retainContextWhenHidden`). */
  readonly visible: boolean;
  /** `visible` changed. */
  readonly onDidChangeViewState: Event<void>;
  /**
   * Fires once, right before the panel goes: another file (or this one again) is shown (unless retained), the file is
   * deleted (retained), the provider is disposed, or the widget is disposed. The editor stores what is pending (the element is still in place) and lets go of what it holds.
   */
  readonly onDidDispose: Event<void>;
}

/**
 * A Typst file's editor: its Visual and Source views (the custom editors `visualView.editor` and `sourceView.editor`).
 * One per document, for as long as one of its views lives.
 */
export interface TextEditor {
  readonly document: TypstDocument;
  /** The view the document was shown in last: the one `selection` and `revealRange` use. */
  readonly mode: EditorMode;
  /** The selection in that view, in the source (`from === to` for a caret). */
  readonly selection: SourceRange;
  /** Selects `range` in that view, scrolls it into view and focuses the view. */
  revealRange(range: SourceRange): void;
}

export interface TextEditorSelectionChangeEvent {
  readonly textEditor: TextEditor;
}

/** The editing views of a Typst file: the Visual view or the Source view. */
export type EditorMode = 'visual' | 'source';

/** Where the window's parts go in the workbench's frame, the editors it reports on, and the files there are. */
export interface WindowOptions {
  /** Whether the project has a file at `path` (`showSaveDialog` refuses those). */
  exists(path: ProjectPath): boolean;
  /** The widget's element: messages and input boxes are shown over it. */
  readonly host: HTMLElement;
  /** The status bar's region. */
  readonly statusBar: HTMLElement;
  /** The editing area: a custom editor's panel goes into it. */
  readonly editingArea: HTMLElement;
  /** Every change of a project file (retained panels follow renames and go with deleted files). */
  readonly onDidChangeFile: Event<FileChange>;
  /** The file shown in the editing area (the workbench decides). */
  activeFile(): ProjectPath;
  /** A file was shown in the editing area (fired by the workbench). */
  readonly onDidChangeActiveFile: Event<ProjectPath>;
  /** The editor of the Typst file shown now (the workbench's editing views). */
  activeTextEditor(): TextEditor | null;
  /** The selection in any editor changed (fired by the workbench's editing views). */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
}

/**
 * The window of one widget: its notification area, its quick input, its status bar items, the custom editors of the
 * editing area and the file decorations. The workbench decides what is shown in the editing area (`showCustomEditor`).
 */
export class WindowHost implements WindowApi {
  readonly #notifications: Notifications;
  readonly #quickInput: QuickInput;
  readonly #statusBar: StatusBar;
  readonly #customEditors: CustomEditors;
  readonly #fileDecorations = new FileDecorations();
  readonly #fileChanges: Disposable;
  readonly onDidChangeFileDecorations = this.#fileDecorations.onDidChange;
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  readonly onDidChangeActiveFile: Event<ProjectPath>;
  /** The CSS of messages, input boxes, quick picks and custom editors' panels, for the workbench to put where the widget renders. */
  readonly styleSheet: string = css;

  constructor(private readonly options: WindowOptions) {
    this.#notifications = new Notifications(options.host);
    this.#quickInput = new QuickInput(options.host);
    this.#statusBar = new StatusBar(options.statusBar);
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

  showSaveDialog(options?: SaveDialogOptions): Promise<ProjectPath | undefined> {
    return showSaveDialog((input) => this.showInputBox(input), (path) => this.options.exists(path), options);
  }

  registerStatusBarItem(element: HTMLElement, placement: StatusBarPlacement): Disposable {
    return this.#statusBar.add(element, placement);
  }

  registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable {
    return this.#customEditors.register(viewType, provider, options);
  }

  /**
   * Shows `file` in its custom editor (`viewType` if it matches, else the one chosen last or the one its name picks)
   * in the editing area; returns that editor's view type, undefined when none matches (nothing is shown).
   */
  showCustomEditor(file: CustomDocument, viewType?: string): string | undefined {
    return this.#customEditors.show(file, viewType);
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
    Disposable.from(this.#fileChanges, this.#notifications, this.#quickInput, this.#customEditors, this.#fileDecorations).dispose();
  }
}
