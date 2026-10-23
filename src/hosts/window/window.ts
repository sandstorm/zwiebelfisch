import type { CancellationToken } from '../../core/cancellation/cancellation';
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileContent, Project } from '../../core/project/project';
import type { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import type { User } from '../../core/user/user';
import type { CommandsHost, MenuContext, MenuItem } from '../commands/commands';

/**
 * The window (VS Code's `window` namespace): everything the user sees and interacts with.
 *
 * Extensions use it to:
 * - tell and ask: messages, input boxes, quick picks, a save dialog, context menus, progress
 * - fill places: side panels, the status bar, the editing area (editors), the editor header and footer, menus, file
 *   decorations, search providers, style sheets
 * - open files, and follow which file and which Typst editor the user works in
 */
export interface WindowApi {
  /** The document the widget lives in, to create elements for it. */
  readonly ownerDocument: Document;
  /**
   * Who works in the widget: as the host said (`createEditor({ user })`), until an extension knows better
   * (`setUser`); undefined: anonymous. Read it when it is needed: it may change.
   */
  readonly user: User | undefined;
  /** Replaces `user`, e.g. with the account signed in at a server (the collaboration extension's): others see that name. */
  setUser(user: User): void;

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
   * `showInputBox`. Resolves to the item picked, undefined when cancelled.
   */
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
   * `files/row`): the entries registered for it (`registerMenuItem`) whose `when` holds in
   * `options.context`, sorted, a separator between groups, a check mark at the entries whose `toggled` holds. Choosing one runs its command with `options.args`, after
   * the menu closed and gave the focus back. Nothing is shown while no entry applies. One at a time: a new menu closes
   * the open one; so do Escape and a press elsewhere.
   */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /**
   * Shows that `task` runs, where `options.location` says, until the promise it returns settles (VS Code's
   * `window.withProgress`, without reports); resolves or rejects as it does.
   */
  withProgress<R>(options: ProgressOptions, task: () => Promise<R>): Promise<R>;
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
   * area, until disposed (VS Code's editors; the Typst files' Visual and Source editors are two of them,
   * `visualEditor` and `sourceEditor`). `viewType` names the editor (unique; an extension's `<extension>.<name>`),
   * e.g. for `showDocument(path, { viewType })`. When several match a file, the editing area's tabs switch between them
   * (`displayName`), and the one the user chose last opens it; before any choice, the one of the highest `priority`
   * (`'default'`: 100), then the most specific pattern (`*.drawio.png` over `*.png`), then the one registered first;
   * a `'fallback'` editor only when no other matches, an `'option'` editor only when chosen, each time.
   */
  registerEditorProvider(viewType: string, provider: EditorProvider, options: EditorProviderOptions): Disposable;

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
   * The icon of `path` for a side panel that lists files: that of the editor opening it by default (its `icon`);
   * undefined when it has none, or no editor opens it (a Typst file).
   */
  getFileIcon(path: ProjectPath): string | undefined;

  /**
   * Shows `path` in the editing area (VS Code's `window.showTextDocument`, for any file the project has), in a custom
   * editor (`registerEditorProvider`; a Typst file's are the Visual and the Source editor): the one `viewType`
   * names, else the one the user chose last, else the default one; nothing without one. Showing the shown file again shows it again (an editor without
   * `retainContextWhenHidden` gets the current content in a new panel). `selection` is revealed in that editor
   * (offsets into the file's text; an editor gets it as `onDidRequestReveal`).
   */
  showDocument(path: ProjectPath, options?: DocumentShowOptions): void;
  /** The file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /** After a file was shown in the editing area (also when the same file is shown again). */
  readonly onDidChangeActiveFile: Event<ProjectPath>;
  /** The editor of the Typst file shown in the editing area (its panel's `textEditor`); null while another kind of file is shown. */
  readonly activeTextEditor: TextEditor | null;
  /**
   * The selection in an editor moved, or its text changed (fired from the editors' own updates, so `selection` is
   * the new one already). Any document's editor, not only the active one: a hidden editor follows the text, too.
   */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  /** Whether the user works in the editing area (the focus is inside it). */
  isEditorFocused(): boolean;

  /**
   * Adds a side panel with its rail button on `options.side` (one panel per side is shown at a time); disposing removes
   * both. Ids are unique across both sides; the right side has the preview (`preview`) built in. Each panel has a
   * command `workbench.view.<id>` (VS Code's `workbench.view.explorer`): it shows and focuses the panel, or hides it
   * when it is shown and has the focus (the focus back where it was). The rail button's tooltip names its key.
   */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /**
   * Shows `header` right before and `footer` right after the shown file's editor, across tab and file switches: inside
   * the panel of an editor that names its `contentElement` (a Typst file's; in the Visual editor below its toolbar),
   * scrolling with it; around any other editor's panel, not scrolling. Detached while no editor is shown. Only one at a
   * time.
   */
  registerEditorHeaderFooter(headerFooter: { header: HTMLElement; footer: HTMLElement }): Disposable;
  /**
   * Adds `css` where the widget renders (the page's `<head>`, or the shadow root of a `<zwiebelfisch-editor>`), after the
   * widget's own stylesheet, until disposed. An extension styles what it adds this way, under class names of its own,
   * with the colors of the `--zwf-*` tokens (light and dark). Widgets in one root share each stylesheet.
   */
  registerStyleSheet(css: string): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget and not taken by an editor inside (the Typst editors upload
   * the files dropped into their text themselves). The widget never lets the browser open a dropped file; it shows the
   * drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;

  /**
   * Adds `item` to the menu `menuId` until disposed (VS Code's `contributes.menus`). Whoever shows a menu renders
   * the items whose `when` holds there, sorted by `group` and `order`, and runs an item's command with the menu's
   * arguments. The window shows these: `window/editorTitle`, buttons at the right end of the editing area's tab bar, and
   * `window/view`, the "View" menu after them (context of both: `activeEditorId` (the view type of the editor shown),
   * `resource` (the shown file); no arguments); `window/railLeft` and `window/railRight`, a button per item
   * among the side's rail buttons by `order` (as `SidePanelOptions.order`; the tooltip names the key; no context, no
   * arguments). Other ids are menus that extensions show (`showContextMenu`), documented there (the file panel:
   * `files/new`, `files/row`; the Visual editor's: `visualEditor/toolbar` and the others its host
   * documents; the preview's toolbar: `preview/toolbar`). `C` is the context the menu is shown in, as that menu documents it.
   */
  registerMenuItem<C extends object = MenuContext>(menuId: string, item: MenuItem<C>): Disposable;
  /**
   * The items of `menuId` to show in `context` (those whose `when` holds), sorted, each with its title and icon (its
   * command's unless its own), for whatever shows that menu (or searches it).
   */
  getMenuItems<C extends object = MenuContext>(menuId: string, context?: C): readonly MenuItem<C>[];
  /** Items of a menu (its id) were registered or disposed. */
  readonly onDidChangeMenu: Event<string>;
}

/** How `showDocument` shows a file (VS Code's `TextDocumentShowOptions`). */
export interface DocumentShowOptions {
  /** A range of the file to reveal (offsets into its text). */
  selection?: SourceRange;
  /**
   * The editor to open the file in, if it matches the file (its view type, e.g. `sourceEditor`); it is
   * then the user's choice for later opens, too (but for an `'option'` editor). Default: the one chosen last, else
   * the one its name picks.
   */
  viewType?: string;
}

export interface SidePanelOptions {
  /** Shown on the rail button (as its tooltip and accessible name). */
  label: string;
  /** The rail button's icon: SVG markup, drawn in `currentColor`. */
  icon: string;
  /** The side whose rail gets the button; default `'left'`. */
  side?: 'left' | 'right';
  /** The rail's group the button goes into: `'top'` (the default) or `'bottom'`, at the rail's far end. */
  alignment?: 'top' | 'bottom';
  /** The rail button's place among the others of its side and group (lower first; equal: registration order); default 0. */
  order?: number;
}

/** A registered side panel: the element its content goes into, how it opens, and whether it is shown. */
export interface SidePanel {
  readonly body: HTMLElement;
  /**
   * Whether it is shown now: its side shows it (an overlay over the narrow widget's editing area while it is open,
   * too). An unavailable panel is not.
   */
  readonly visible: boolean;
  /** Fires when `visible` changes, e.g. to do work for the panel only while it is seen. */
  readonly onDidChangeVisibility: Event<void>;
  /**
   * Shows it by default: unless the viewer picked a panel of its side (or hid the side) this session, the side names
   * another default (the right side's: the setting `workbench.rightSidePanel`), or the widget is narrow (left side).
   */
  setDefault(open: boolean): void;
  /** Shows or removes it and its rail button altogether (e.g. the setting `files.panel: 'hide'`). */
  setAvailable(available: boolean): void;
  /**
   * Shows it as if the viewer picked it on the rail (VS Code's `WebviewView.show`), and focuses it unless
   * `preserveFocus`: its element marked `autofocus` (as a dialog's), else its first focusable one, else the panel
   * itself. Nothing while it is unavailable.
   */
  show(preserveFocus?: boolean): void;
  /** Closes it if it lies over the editing area (narrow widget, left side), e.g. after something was chosen in it. */
  dismiss(): void;
  dispose(): void;
}

/**
 * The drag data type (`DataTransfer`) of a project file dragged inside the widget, e.g. a row of the file panel; the
 * data is its path. Any editor may take such a drop (the Typst editors insert what the drop edit providers make of it).
 */
export const PROJECT_PATH_TYPE = 'application/x-zwf-project-path';

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
  /** What the entries' `when` and `toggled` are asked with; default: nothing. */
  readonly context?: MenuContext;
  /** The chosen entry's command gets these (e.g. the row's path); default: none. */
  readonly args?: readonly unknown[];
}

/**
 * Where `withProgress` shows a task (VS Code's ProgressLocation, ours): `EditingArea`, a note over the editing area
 * with the title, the editing area taking no input meanwhile, for a task the editors must wait for (the room's text
 * before it is shown).
 */
export const ProgressLocation = { EditingArea: 20 } as const;

export type ProgressLocation = (typeof ProgressLocation)[keyof typeof ProgressLocation];

/** How `withProgress` shows a task (VS Code's ProgressOptions, without cancelling). */
export interface ProgressOptions {
  readonly location: ProgressLocation;
  /** What runs ("Connecting to the room…"). */
  readonly title?: string;
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
 * Where an editor opens files (VS Code: the `selector`, `priority` and `displayName` of
 * `contributes.customEditors`) and how its panels live.
 */
export interface EditorProviderOptions {
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
   * tab, `showDocument(path, { viewType })`).
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
export interface EditorProvider {
  /**
   * Fills `panel` with the editor of `document`: called whenever such a file is opened, each time with a new panel.
   * The editor stores what it changes through `workspace.applyEdit` (an `update` with the new content).
   */
  resolveEditor(document: EditorDocument, panel: EditorPanel): void;
}

/** The file an editor opens: where it is, and its content when it was opened. */
export interface EditorDocument {
  readonly path: ProjectPath;
  readonly content: FileContent;
}

/** Where an editor shows one opened file (VS Code's WebviewPanel, with an element instead of a webview). */
export interface EditorPanel {
  /** The editor's place in the editing area (a flex column filling it); removed once the panel is disposed. */
  readonly element: HTMLElement;
  /** Whether the panel is shown (false while hidden; only with `retainContextWhenHidden`). */
  readonly visible: boolean;
  /** `visible` changed. */
  readonly onDidChangeViewState: Event<void>;
  /**
   * A range of the file is to be shown (`showDocument(path, { selection })`, offsets into its text), right after the
   * panel is shown: the editor selects it, scrolls it into view and takes the focus.
   */
  readonly onDidRequestReveal: Event<SourceRange>;
  /**
   * Fires once, right before the panel goes: another file (or this one again) is shown (unless retained), the file is
   * deleted (retained), the provider is disposed, or the widget is disposed. The editor stores what is pending (the element is still in place) and lets go of what it holds.
   */
  readonly onDidDispose: Event<void>;
  /** The Typst file's editor shown in the panel, set by its provider: `activeTextEditor` while the panel is shown. */
  textEditor?: TextEditor;
  /**
   * The first element of the file's content in `element`, set by a provider whose editor scrolls the whole panel: the
   * editor header and footer goes into the panel, right before it and at the panel's end.
   */
  contentElement?: Element;
}

/**
 * A Typst file's editor: its Visual and Source editors (the editors `visualEditor` and `sourceEditor`).
 * One per document, for as long as one of them lives.
 */
export interface TextEditor {
  readonly document: TypstDocument;
  /**
   * The editor the document was shown in last (its view type: `VISUAL_EDITOR` or `SOURCE_EDITOR`), the
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

/** What the window shows and works with: the project, the widget's element, and the hosts it shows. */
export interface WindowOptions {
  /** The widget's element: the window builds its regions (sides, editing area, status bar) in it. */
  readonly host: HTMLElement;
  /** The files it shows (the main file first); it keeps the editing area on an existing file as they change. */
  readonly project: Project;
  /** Runs the menus' commands and names their keys; gets the side panels' commands `workbench.view.<id>`. */
  readonly commands: CommandsHost;
  /** The selection changes of the Typst files' editors, as `onDidChangeTextEditorSelection`. */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  /** Where the layout keeps its sizes and the panels picked for the session (key `layout`). */
  readonly layoutState: { get<T>(key: string): T | undefined; update(key: string, value: unknown): Promise<void> };
  /** Who works here (`user`) until `setUser`. */
  readonly user?: User;
  /**
   * The widget's color tokens and frame (CSS), put where it renders before anything is built (the color scheme reads
   * the resolved colors), as `<style id="zwf-editor-styles">` together with the layout's own CSS.
   */
  readonly styleSheet?: string;
}

export { WindowHost } from './window-impl';
