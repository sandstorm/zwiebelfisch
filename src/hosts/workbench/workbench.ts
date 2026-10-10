// The workbench host: the widget's frame (side panels, editing area with the Visual / Source tabs and custom editors,
// preview, status bar) and the extension API every feature uses to put itself into it. Entry of hosts/workbench/.
// Why extensions: the frame knows no feature by name. A feature is a `TypstExtension` that registers what it adds
// (a side panel, a custom editor, a command, a menu item, a link provider, a source control) once, at activation, and the
// host disposes all of it on destroy. What every feature needs to talk to the user (messages, input boxes, quick
// picks) is the workbench's, in VS Code's shapes, so features look and behave alike. Adding a feature is adding it to a list, not editing the frame. Extensions never
// depend on each other: what one offers another goes through a generic contribution point of a host.
// See ARCHITECTURE.md, "Extensions" and "Layout".
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { PreviewContributions } from '../preview/preview';
import type { SourceViewContributions } from '../source-view/source-view';
import type { VisualViewContributions } from '../visual-view/visual-view';
import type { EditorMode } from './editing-views/editing-views';
import type { Memory } from './layout/layout';

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
  /** Registers the extension's contributions; everything it pushes into `context.subscriptions` is disposed on destroy. */
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

/** What an extension gets to work with. Contributions are registered once, at activation; the hosts apply them to every view they create later. */
export interface ExtensionContext {
  /** Disposed when the widget is destroyed, in reverse order (the extensions in reverse list order, too). */
  readonly subscriptions: { dispose(): unknown }[];
  readonly project: Project;
  /** The settings (VS Code's `workspace.getConfiguration` / `onDidChangeConfiguration`). */
  readonly workspace: Workspace;
  readonly workbench: Workbench;
  /** Node and mark specs, toolbar items, gutters, box renderers and editor extensions for every Visual view. */
  readonly visualView: VisualViewContributions;
  /** CodeMirror extensions for every Source view. */
  readonly sourceView: SourceViewContributions;
  /** Toolbar items, PDF export options and page overlays of the preview; reveal and clicks; its compile results (diagnostics, snippets, PDFs). */
  readonly preview: PreviewContributions;
}

/** The values of settings by full id (`{ 'pdfExport.download': false }`): JSON-like values. */
export type Settings = Readonly<Record<string, unknown>>;

/** A JSON type a setting's value may have. */
export type ConfigurationType = 'boolean' | 'string' | 'number' | 'object' | 'array' | 'null';

/** One setting as an extension declares it (VS Code's configuration property). */
export interface ConfigurationProperty {
  /** The value's type, or the types it may have (`['string', 'null']`). A value of another type counts as unset. */
  readonly type: ConfigurationType | readonly ConfigurationType[];
  /** Its value while the host sets none. */
  readonly default: unknown;
  /** What it does, for people configuring the widget. */
  readonly description: string;
  /** The only values it may have. */
  readonly enum?: readonly unknown[];
}

/** The settings as extensions read them (VS Code's `workspace` namespace, as far as settings go). */
export interface Workspace {
  /** The settings under `section` (`getConfiguration('pdfExport').get('download')`), or all by full id. */
  getConfiguration(section?: string): WorkspaceConfiguration;
  /** Some settings changed their value (the host set new ones). */
  readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
}

/** The settings of one section (VS Code's WorkspaceConfiguration). */
export interface WorkspaceConfiguration {
  /** The value the host set, else the declared default; undefined (or `defaultValue`) for a setting no one declares. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Whether the setting is declared or has a value. */
  has(key: string): boolean;
  /** Where the value comes from: the declared default, and the host's value if it set a valid one (`globalValue`). */
  inspect<T>(key: string): ConfigurationInspect<T> | undefined;
}

export interface ConfigurationInspect<T> {
  /** The full id. */
  readonly key: string;
  readonly defaultValue?: T;
  /** The value the host set (VS Code: the user's), absent when it set none. */
  readonly globalValue?: T;
}

/** Which settings changed (VS Code's ConfigurationChangeEvent). */
export interface ConfigurationChangeEvent {
  /** Whether the setting `section` (a full id), or one under it (`pdfExport`), changed. */
  affectsConfiguration(section: string): boolean;
}

/** A command as data (VS Code's Command), e.g. what a document link's hover offers to do. */
export interface Command {
  /** The label of the button or menu entry ("Create chapter.typ"). */
  readonly title: string;
  /** The id of the command (`Workbench.registerCommand`). */
  readonly command: string;
  /** The arguments it is run with. */
  readonly arguments?: readonly unknown[];
}

/** Who works in the widget (`createTypstEditor({ user })`). */
export interface User {
  /** The name others see (collaborating), that signs comments and commits. */
  readonly name: string;
  /** The color others see the user's cursor in (default: one made from the name). */
  readonly color?: string;
}

/** The widget's frame as extensions see it: which file is shown, and the places they can put things. */
export interface Workbench {
  /** The document the widget lives in, to create elements for it. */
  readonly ownerDocument: Document;
  /** The file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /** Who works in the widget, as the host said (`createTypstEditor({ user })`); undefined: anonymous. */
  readonly user: User | undefined;
  /**
   * Shows `path` in the editing area (if the project has it): a Typst file in the Visual / Source tabs, any other
   * file in its custom editor (`registerCustomEditorProvider`; `viewType` picks one, else the default one; nothing
   * without one). Opening the shown file again shows it again (its editor gets the current content in a new panel).
   * `selection` reveals a range of a Typst file, in the Source tab with `mode`.
   */
  open(path: ProjectPath, options?: OpenOptions): void;
  /** After a file was shown in the editing area (also when the same file is shown again). */
  readonly onDidShowFile: Event<ProjectPath>;
  /**
   * Applies `change` if the project allows it and then the host (`allowFileChange`, may be async; the project is
   * asked again afterwards). Resolves to the reason it was refused, or null once applied.
   */
  applyChange(change: FileChange): Promise<string | null>;

  /**
   * Adds `css` where the widget renders (the page's `<head>`, or the shadow root of a `<typst-editor>`), after the
   * widget's own stylesheet, until disposed. An extension styles what it adds this way, under class names of its own,
   * with the colors of the `--te-*` tokens (light and dark). Widgets in one root share each stylesheet.
   */
  registerStyleSheet(css: string): Disposable;
  /** Adds a side panel with its rail button (one panel is open at a time); disposing removes both. */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /**
   * Puts `element` into the status bar below everything, until disposed: on the side `placement.alignment` says, the
   * higher `placement.priority` further left within it (VS Code's StatusBarItem).
   */
  registerStatusBarItem(element: HTMLElement, placement: StatusBarPlacement): Disposable;
  /**
   * Shows `top` right before and `bottom` right after the shown Typst file's content (in the Visual tab below its
   * toolbar), scrolling with it, across tab and file switches; detached while no Typst file is shown. One frame at a time.
   */
  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable;
  /**
   * Opens files whose name matches `options.filenamePattern` (not Typst files: they open in the Visual / Source tabs)
   * in the editor `provider` puts into a panel of the editing area, until disposed (VS Code's custom editors).
   * `viewType` names the editor (`<extension>.<name>`, unique), e.g. for `open(path, { viewType })`. When several
   * match a file, the one of the highest `priority` opens it (`'default'`: 100; `'option'`: only when asked for by
   * `viewType`), then the most specific pattern (`*.drawio.png` over `*.png`), then the one registered first.
   */
  registerCustomEditorProvider(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable;
  /**
   * Registers `handler` as command `id` (`<extension>.<name>`, e.g. `pdfExport.export`) until disposed; an id
   * registered twice is an error. Other extensions and the host run it by id (`executeCommand`), never by importing it.
   */
  registerCommand(id: string, handler: (...args: any[]) => unknown): Disposable;
  /**
   * Runs command `id` with `args` and resolves to its result (awaited if it is a Promise). The handler is called
   * synchronously, so the user's gesture, the selection and the focus are as now. Rejects for an unknown id and when
   * the handler throws or rejects.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /**
   * Runs `command` (without arguments) on `key` anywhere in the widget, before the editors see the key (they never
   * do; a failing command is logged). `key`: modifiers and a `KeyboardEvent.code`, joined by `+`, e.g. `Mod+Alt+KeyM`
   * (Mod: Ctrl or Cmd). Unnamed modifiers are not checked.
   */
  registerKeybinding(key: string, command: string): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget (and not taken by a view inside, such as the Visual view
   * taking images). The widget never lets the browser open a dropped file; it shows the drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;
  /** A value remembered for the browser session under this widget's key (`name` tells values apart). */
  remember<T>(name: string): Memory<T>;

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
   * Adds links to Typst text until disposed: the Source views and the code of the Visual view's raw boxes show
   * them (Mod+click, Alt+Enter, hover). The links of every provider are merged; where links overlap, the provider
   * of the higher `priority` wins (default 100, higher first; equal: registration order).
   */
  registerDocumentLinkProvider(provider: DocumentLinkProvider, options?: { priority?: number }): Disposable;
  /**
   * The links of `document` from every provider, merged as the views show them, in text order (VS Code's
   * `vscode.executeLinkProvider`), for an extension that shows links itself (an image box's path).
   */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** `link` (from `provideDocumentLinks`) with what its provider fills in on demand: target, tooltip, command. */
  resolveDocumentLink(link: DocumentLink): DocumentLink;

  /**
   * Offers `sourceControl` (VS Code's `scm.createSourceControl`) until disposed: somewhere the project can be
   * committed, shown by whichever extension shows source controls. One per `id`.
   */
  registerSourceControl(sourceControl: SourceControl): Disposable;
  /** The registered source controls, in registration order. */
  readonly sourceControls: readonly SourceControl[];
  /** A source control was registered or disposed. */
  readonly onDidChangeSourceControls: Event<void>;

  /** The editor of the Typst file shown in the editing area; null while another kind of file is shown. */
  readonly activeTextEditor: TextEditor | null;
  /**
   * The selection in an editor moved, or its text changed (fired from the views' own updates, so `selection` is
   * the new one already). Any document's editor, not only the active one: a hidden view follows the text, too.
   */
  readonly onDidChangeTextEditorSelection: Event<TextEditorSelectionChangeEvent>;
  /** Whether the user works in the editing area (the focus is inside it). */
  isEditorFocused(): boolean;
}

/** A button of a message (VS Code's MessageItem); the message resolves to the one chosen. */
export interface MessageItem {
  readonly title: string;
}

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

/** One entry of a menu (VS Code's `contributes.menus` entry): a command by its id, shown while `when` holds. */
export interface MenuItem {
  /** The command the entry runs (`executeCommand`), with the arguments of the menu it is in. */
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

/** How serious a message is. */
export type MessageSeverity = 'info' | 'warning' | 'error';

export interface OpenOptions {
  /** A range of the Typst file (source offsets) to reveal. */
  selection?: { from: number; to: number };
  /** Reveals in that tab (switching to it); default: the current one. */
  mode?: EditorMode;
  /** The custom editor to open a file that is not Typst source in (its view type); default: the one its name picks. */
  viewType?: string;
}

/**
 * Where a status bar item goes, as VS Code's `StatusBarItem`: `left` items from the bar's start, `right` items at its
 * end; within a side the higher `priority` further left (default 0), equal priorities in registration order.
 */
export interface StatusBarPlacement {
  readonly alignment: 'left' | 'right';
  readonly priority?: number;
}

export interface SidePanelOptions {
  /** Shown on the rail button (as its tooltip and accessible name). */
  label: string;
  /** The rail button's icon. */
  icon: Element;
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
 * The Typst text a link provider reads (VS Code's TextDocument, as far as links need it): a whole file's, or the
 * code of one raw box in it.
 */
export interface TextDocument {
  /** The file the text is in: relative paths in it resolve from here. */
  readonly path: ProjectPath;
  readonly text: string;
}

/** A range of a text that leads somewhere (VS Code's DocumentLink). */
export interface DocumentLink {
  /** Where the link is, as offsets in the text given to the provider. */
  readonly range: { readonly from: number; readonly to: number };
  /** The project file following the link opens; absent until resolved, or when it leads to no file. */
  readonly target?: ProjectPath;
  /** What the hover says about the link (e.g. that its file is missing). */
  readonly tooltip?: string;
  /**
   * What the hover offers to do instead (VS Code: a `command:` link), e.g. create the missing file. If the command
   * rejects, the hover shows the error's message.
   */
  readonly command?: Command;
}

/** Finds the links in Typst text (VS Code's DocumentLinkProvider). */
export interface DocumentLinkProvider {
  /** The links in `document` (cheap ones: `resolveDocumentLink` may fill in the rest when one is shown or followed). */
  provideDocumentLinks(document: TextDocument): readonly DocumentLink[];
  /** A link this provider gave, with its target, tooltip or command filled in. */
  resolveDocumentLink?(link: DocumentLink): DocumentLink;
}

/** Somewhere the project's state can be committed (VS Code's SourceControl), e.g. the GitLab branch behind a room. */
export interface SourceControl {
  /** Unique among the registered ones. */
  readonly id: string;
  /** Names it to people ("GitLab"). */
  readonly label: string;
  /** The commit message offered (VS Code: the input box's placeholder). */
  readonly defaultCommitMessage?: string;
  /** What it is doing, and what happened last. */
  readonly state: SourceControlState;
  /** `state` changed. */
  readonly onDidChange: Event<void>;
  /** Commits the project's current state with `message` (VS Code: its accept-input command); the outcome shows in `state`. */
  commit(message: string): void;
}

export interface SourceControlState {
  /** A commit is under way (no second one meanwhile). */
  readonly busy: boolean;
  /**
   * The last outcome or piece of news ("Saved version 01234567 (Ann)", "Merged new changes from GitLab"), told to
   * the user once, when it changes (a new object); null for none.
   */
  readonly status: SourceControlStatus | null;
}

/** An outcome or a piece of news of a source control, told as a message. */
export interface SourceControlStatus {
  readonly message: string;
  readonly severity: MessageSeverity;
}

/** Where a custom editor opens files (VS Code: the `selector` and `priority` of `contributes.customEditors`). */
export interface CustomEditorOptions {
  /**
   * The files it opens, as a glob over the file name: `*` (any characters but `/`), `**`, `?`, `{a,b}`, e.g.
   * `*.drawio.png`, `*.{png,jpg}`; with a `/` over the path from the project root (`diagrams/*.png`). Case-insensitive.
   */
  readonly filenamePattern: string;
  /**
   * Who opens a file several editors match: a number (higher first), `'default'` (100, the default) or `'option'`
   * (never by default, only when asked for with `open(path, { viewType })`).
   */
  readonly priority?: 'default' | 'option' | number;
}

/** Shows (and edits) files in the editing area (VS Code's CustomReadonlyEditorProvider, without documents of its own). */
export interface CustomEditorProvider {
  /**
   * Fills `panel` with the editor of `document`: called whenever such a file is opened, each time with a new panel.
   * The editor stores what it changes through `Workbench.applyChange` (an `update` with the new content).
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
  /**
   * Fires once, right before the panel goes: another file (or this one again) is shown, the provider is disposed, or
   * the widget is destroyed. The editor stores what is pending (the element is still in place) and lets go of what it holds.
   */
  readonly onDidDispose: Event<void>;
}

/**
 * A Typst file's editor: its Visual and Source views, behind the Visual / Source tabs. One per document, for as
 * long as its views live.
 */
export interface TextEditor {
  readonly document: TypstDocument;
  /** The tab the user works in: the view `selection` and `revealRange` use. */
  readonly mode: EditorMode;
  /** The selection in that view, as source offsets (`from === to` for a caret). */
  readonly selection: { readonly from: number; readonly to: number };
  /** Selects `from`..`to` (source offsets) in that view, scrolls it into view and focuses the view. */
  revealRange(from: number, to: number): void;
}

export interface TextEditorSelectionChangeEvent {
  readonly textEditor: TextEditor;
}

export { WorkbenchHost, type WorkbenchOptions } from './workbench-host';
export type { EditorMode } from './editing-views/editing-views';
export type { Memory } from './layout/layout';
export { default as workbenchStyles } from './layout/layout.css?inline';
