import type { CancellationToken } from '../../core/cancellation/cancellation';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent } from '../../core/project/project';
import type { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';

/**
 * The window (VS Code's `window` namespace): how extensions talk to the user, and the places they fill.
 *
 * Extensions use it to:
 * - tell and ask: messages, input boxes, quick picks, a save dialog, context menus, progress
 * - fill places: the status bar, the editing area (custom editors), file decorations, search providers
 * - follow which file and which Typst editor the user works in
 */
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
   * A quick pick its owner drives (VS Code's `window.createQuickPick`): wider than `showQuickPick`'s, at the top in
   * the middle of the widget, with the items the owner sets as the text changes. Hidden until `show`; one box at a
   * time, as `showInputBox`.
   */
  createQuickPick<T extends QuickPickItem>(): QuickPick<T>;
  /**
   * Asks where a new file goes (VS Code's `window.showSaveDialog`, as an input box placed as `showInputBox`): a name,
   * starting in the folder of `defaultUri` (or proposing it, see `SaveDialogOptions`), with the first `filters` ending added to a name without one. A name
   * without one of the endings, or of a file the project has, is refused. Resolves to the path, or undefined when
   * cancelled; creating the file is the caller's (`workspace.applyEdit`).
   */
  showSaveDialog(options?: SaveDialogOptions): Promise<ProjectPath | undefined>;
  /**
   * Pops up the menu `menuId` at `options.anchor` (as VS Code's workbench shows a contributed menu, e.g.
   * `explorer/context`): the entries registered for it (`workbench.registerMenuItem`) whose `when` holds in
   * `options.context`, sorted, a separator between groups, a check mark at the entries whose `toggled` holds. Choosing one runs its command with `options.args`, after
   * the menu closed and gave the focus back. Nothing is shown while no entry applies. One at a time: a new menu closes
   * the open one; so do Escape and a press elsewhere.
   */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /**
   * Shows that `task` runs, where `options.location` says, until the promise it returns settles (VS Code's
   * `window.withProgress`); resolves or rejects as it does. The task tells how it goes with `progress.report({ message,
   * increment })` (`increment`: percent done since the last report; none: no bar of known length).
   */
  withProgress<R>(options: ProgressOptions, task: (progress: Progress<ProgressReport>) => Promise<R>): Promise<R>;
  /**
   * Adds what `provider` finds to search everywhere (the searchEverywhere extension's, double Shift) until disposed: a
   * group of results under `provider.label`. `provider.id` is unique.
   */
  registerSearchProvider(provider: SearchProvider): Disposable;
  /** The search providers registered now, in registration order, for whoever shows search everywhere. */
  getSearchProviders(): readonly SearchProvider[];

  /**
   * Puts `element` into the status bar below everything, until disposed: on the side `placement.alignment` says, the
   * higher `placement.priority` further left within it (VS Code's StatusBarItem).
   */
  registerStatusBarItem(element: HTMLElement, placement: StatusBarPlacement): Disposable;
  /**
   * Opens files whose name matches `options.filenamePattern` in the editor `provider` puts into a panel of the editing
   * area, until disposed (VS Code's custom editors; the Typst files' Visual and Source editors are two of them,
   * `visualEditor` and `sourceEditor`). `viewType` names the editor (unique; an extension's `<extension>.<name>`),
   * e.g. for `workbench.open(path, { viewType })`. When several match a file, the editing area's tabs switch between them
   * (`displayName`), and the one the user chose last opens it; before any choice, the one of the highest `priority`
   * (`'default'`: 100), then the most specific pattern (`*.drawio.png` over `*.png`), then the one registered first;
   * a `'fallback'` editor only when no other matches, an `'option'` editor only when chosen.
   */
  registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable;

  /**
   * Adds decorations to files (badges on their rows in the side panels that list files, such as other users' initials)
   * until disposed. Several providers may decorate the same file; their decorations are shown in registration order.
   */
  registerFileDecorationProvider(provider: FileDecorationProvider): Disposable;
  /** The decorations of `path` from every provider, for a side panel that lists files. */
  getFileDecorations(path: ProjectPath): readonly FileDecoration[];
  /** Decorations changed: of these files, or of any (undefined). */
  readonly onDidChangeFileDecorations: Event<readonly ProjectPath[] | undefined>;
  /**
   * The icon of `path` for a side panel that lists files: that of the custom editor opening it by default (its `icon`);
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
   * The selection in an editor moved, or its text changed (fired from the editors' own updates, so `selection` is
   * the new one already). Any document's editor, not only the active one: a hidden editor follows the text, too.
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

/** An item of `showQuickPick` and `createQuickPick` (VS Code's QuickPickItem). */
export interface QuickPickItem {
  /** What the item is called; typing filters by it. */
  readonly label: string;
  /** Less prominent, after the label. */
  readonly description?: string;
  /** Less prominent, on a line of its own. */
  readonly detail?: string;
  /** Checked at first (with `canPickMany`). */
  readonly picked?: boolean;
  /** The characters marked where the typed text matched (`createQuickPick`: its owner matched them). */
  readonly highlights?: QuickPickHighlights;
  /** The key that does the same, as people read it (`⌘⇧F`), at the row's end. */
  readonly keybinding?: string;
}

/** What `QuickPickSeparator.kind` says (VS Code's QuickPickItemKind). */
export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

export type QuickPickItemKind = (typeof QuickPickItemKind)[keyof typeof QuickPickItemKind];

/** A heading starting a group of a `QuickPick`'s items (VS Code's separator item), with a note after it. */
export interface QuickPickSeparator {
  readonly kind: typeof QuickPickItemKind.Separator;
  readonly label: string;
  readonly description?: string;
}

/**
 * A quick pick its owner drives (VS Code's QuickPick, as far as needed): it shows `items` as they are (the owner
 * filters and marks them as `value` changes) and tells what the user does. Picking an item (Enter, a click) fires
 * `onDidAccept` with it in `selectedItems`; the box stays until `hide`. Escape, a press outside or another box hide it.
 */
export interface QuickPick<T extends QuickPickItem> {
  /** The box's accessible name and the field's label. */
  title: string | undefined;
  /** Shown in the empty field. */
  placeholder: string | undefined;
  /** The text in the field; setting it fires `onDidChangeValue` (the caret goes after it once shown). */
  value: string;
  /** A line below the list describing the field (e.g. how to narrow a search). */
  prompt: string | undefined;
  /** The rows, the first item active; without any item (and text typed), "No results" unless `busy`. */
  items: readonly (T | QuickPickSeparator)[];
  /** Items are still coming: a progress line. */
  busy: boolean;
  /** The item picked last. */
  readonly selectedItems: readonly T[];
  /** The text in the field changed (typed, or set). */
  readonly onDidChangeValue: Event<string>;
  /** An item was picked (`selectedItems`). */
  readonly onDidAccept: Event<void>;
  /** The box is gone (`hide`, Escape, a press outside, another box), the focus back where it was. */
  readonly onDidHide: Event<void>;
  /** Shows the box (cancelling an open one) and focuses its field. */
  show(): void;
  /** Hides the box; it can be shown again. */
  hide(): void;
  /** Hides it for good. */
  dispose(): void;
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

/** The [start, end) offsets of the characters to highlight in an item's texts (where a query matched). */
export interface QuickPickHighlights {
  readonly label?: readonly (readonly [number, number])[];
  readonly description?: readonly (readonly [number, number])[];
  readonly detail?: readonly (readonly [number, number])[];
}

/**
 * One kind of thing search everywhere finds (files, headings, commands, …), shown as a group of its own (VS Code's
 * quick access providers, in one list as JetBrains' "Search Everywhere").
 */
export interface SearchProvider {
  /** `<extension>.<name>`, unique. */
  readonly id: string;
  /** The group's heading ("Headings"), and its name in the prefix hint. */
  readonly label: string;
  /**
   * Typed first, narrows the search to the providers with this prefix (`#`), and they show more results. Without:
   * only in the search over everything.
   */
  readonly prefix?: string;
  /** The group's place (lower first; default 100; equal: by `id`). */
  readonly order?: number;
  /**
   * The items for `query` (the text after the prefix, trimmed; '' at first), asked again whenever it changes. Items
   * without `highlights` are matched by the search (fuzzily, against the label, else the description): return every
   * candidate. Items with `highlights` were matched by the provider and are shown as they are, in its order (text
   * search). May be async: check `token` between steps and stop once it is cancelled (the user typed on, or closed
   * the search).
   */
  provideItems(query: string, token: CancellationToken): readonly SearchItem[] | Promise<readonly SearchItem[]>;
}

/**
 * A result of search everywhere: what it shows (as a quick pick item; with `highlights` the provider matched the
 * query itself: the item is shown as given, not matched again) and what picking it does.
 */
export interface SearchItem extends QuickPickItem {
  /**
   * Opens, runs or applies what the item stands for. Called once the search is closed and the focus is back where it
   * was, still within the user's key press or click (a file picker may open).
   */
  accept(): void | Promise<unknown>;
}

/** What `showSaveDialog` asks (VS Code's SaveDialogOptions). */
export interface SaveDialogOptions {
  /** Above the field: what is being made ("New diagram"). The box's accessible name; default "Save". */
  title?: string;
  /**
   * Where the name starts: the folder of this file, or this folder (default: the top of the project). A path the
   * project has no file at, ending in one of `filters`' endings, is proposed as the name (the part before the ending
   * selected), as VS Code's dialog proposes a file name.
   */
  defaultUri?: ProjectPath;
  /**
   * The endings a name may have, by what they are (without the dot, e.g. `{ Diagrams: ['drawio.png'] }`); `'*'`
   * allows any (`{ 'All files': ['*'] }`). The first one is added to a name without an ending. Default: any, none added.
   */
  filters?: Readonly<Record<string, readonly string[]>>;
}

/** Where `showContextMenu` pops up: at a point (viewport coordinates, e.g. a right click's), or below an element (a button). */
export type MenuAnchor = { readonly x: number; readonly y: number } | Element;

/** How `showContextMenu` shows a menu (VS Code's context menu delegate: anchor, context keys, arguments). */
export interface ContextMenuOptions {
  readonly anchor: MenuAnchor;
  /** What the menu is for: its accessible name (a row's name, "New"). */
  readonly title: string;
  /** What the entries' `when` is asked with (the workbench's `MenuContext`); default: nothing. */
  readonly context?: Readonly<Record<string, unknown>>;
  /** The chosen entry's command gets these (e.g. the row's path); default: none. */
  readonly args?: readonly unknown[];
}

/** An entry of a menu as `showContextMenu` shows it (of the workbench's `MenuItem`). */
export interface ContributedMenuItem {
  readonly command: string;
  readonly title?: string;
  readonly group?: string;
  /** Whether it is checked, asked with the menu's context; without: not a checkbox. */
  readonly toggled?: (context: Readonly<Record<string, unknown>>) => boolean;
  /** The key of its command as people read it, at the entry's end. */
  readonly keybinding?: string;
}

/**
 * Where `withProgress` shows a task (VS Code's ProgressLocation): `Window`, a spinner with "title: message" in the
 * status bar; `EditingArea` (not VS Code's), a note over the editing area with the title, the message and a bar, the
 * editing area taking no input meanwhile, for a task the editors must wait for (the room's text before it is shown).
 */
export const ProgressLocation = { Window: 10, EditingArea: 20 } as const;

export type ProgressLocation = (typeof ProgressLocation)[keyof typeof ProgressLocation];

/** How `withProgress` shows a task (VS Code's ProgressOptions, without cancelling). */
export interface ProgressOptions {
  readonly location: ProgressLocation;
  /** What runs ("Connecting to the room…"). */
  readonly title?: string;
}

/** What a task reports (VS Code's `{ message, increment }`). */
export interface ProgressReport {
  /** How it goes ("3.1 / 6.6 MB"); replaces the one before. */
  readonly message?: string;
  /** Percent done since the last report; the increments add up to 100. */
  readonly increment?: number;
}

/** Where a task reports to (VS Code's Progress). */
export interface Progress<T> {
  report(value: T): void;
}

/**
 * Where a status bar item goes, as VS Code's `StatusBarItem`: `left` items from the bar's start, `right` items at its
 * end; within a side the higher `priority` further left (default 0), equal priorities in registration order.
 */
export interface StatusBarPlacement {
  readonly alignment: 'left' | 'right';
  readonly priority?: number;
}

/** How a side panel that lists files marks one (VS Code's FileDecoration): a small badge with a tooltip. */
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
   * Who opens a file several editors match: a number (higher first), `'default'` (100, the default), `'fallback'`
   * (opens only files no other editor matches, and gets no tab) or `'option'` (never by default, only when chosen: a
   * tab, `workbench.open(path, { viewType })`).
   */
  readonly priority?: 'default' | 'fallback' | 'option' | number;
  /**
   * The icon of the files it opens by default, where side panels list files (the file panel): SVG markup with a 16×16 view
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
   * A range of the file is to be shown (`workbench.open(path, { selection })`, offsets into its text), right after the
   * panel is shown: the editor selects it, scrolls it into view and takes the focus.
   */
  readonly onDidRequestReveal: Event<SourceRange>;
  /**
   * Fires once, right before the panel goes: another file (or this one again) is shown (unless retained), the file is
   * deleted (retained), the provider is disposed, or the widget is disposed. The editor stores what is pending (the element is still in place) and lets go of what it holds.
   */
  readonly onDidDispose: Event<void>;
}

/**
 * A Typst file's editor: its Visual and Source editors (the custom editors `visualEditor` and `sourceEditor`).
 * One per document, for as long as one of them lives.
 */
export interface TextEditor {
  readonly document: TypstDocument;
  /**
   * The custom editor the document was shown in last (its view type: `VISUAL_EDITOR` or `SOURCE_EDITOR`), the
   * editor `selection` and `revealRange` use.
   */
  readonly viewType: string;
  /** The selection in that editor, in the source (`from === to` for a caret). */
  readonly selection: SourceRange;
  /** Selects `range` in that editor, scrolls it into view and focuses the editor. */
  revealRange(range: SourceRange): void;
  /**
   * Puts the Typst `snippet` (as it is: no tab stops) in place of the selection in that editor, the cursor after it,
   * and focuses the editor (VS Code's `insertSnippet`). The Visual editor reads it as Typst: inline content into the
   * text, blocks after the block holding the cursor.
   */
  insertSnippet(snippet: string): void;
  /**
   * Changes the document by the edits `callback` makes (source coordinates of the text before them, not overlapping),
   * as one edit of that editor: one undo step there (VS Code's `edit`).
   */
  edit(callback: (editBuilder: TextEditorEdit) => void): void;
}

/** What `TextEditor.edit` gives its callback to make the edits with (VS Code's `TextEditorEdit`). */
export interface TextEditorEdit {
  replace(range: SourceRange, value: string): void;
  insert(offset: SourceOffset, value: string): void;
  delete(range: SourceRange): void;
}

export interface TextEditorSelectionChangeEvent {
  readonly textEditor: TextEditor;
}

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
  /** The editor of the Typst file shown now (the workbench's editors). */
  activeTextEditor(): TextEditor | null;
  /** The selection in any editor changed (fired by the workbench's editors). */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  /** The entries of a menu whose `when` holds in `context`, sorted (the workbench's menus, for `showContextMenu`). */
  menuItems(menuId: string, context: Readonly<Record<string, unknown>>): readonly ContributedMenuItem[];
  /** Runs a command (a chosen menu entry's). */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
}

export { WindowHost } from './window-impl';
