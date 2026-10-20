import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { SourceRange } from '../../core/typst-document/typst-document';
import type { User } from '../../core/user/user';
import type { CommandContribution, Commands, KeybindingContribution, MenuContext, MenuItem } from '../commands/commands';
import type { LanguageContribution, Languages } from '../languages/languages';
import type { PreviewContributions } from '../preview/preview';
import type { Scm } from '../scm/scm';
import type { SourceEditorContributions } from '../source-editor/source-editor';
import type { VisualEditorContributions } from '../visual-editor/visual-editor';
import type { WindowApi } from '../window/window';
import type { ConfigurationProperty, Settings, Workspace } from '../workspace/workspace';

/**
 * A feature of the widget (VS Code's extension), given to `createEditor({ extensions })`, built-in or a host page's own.
 *
 * Each is activated once, in list order, after every extension's `contributes` is known and before any editor exists.
 * What it pushes into `context.subscriptions` is disposed with the widget.
 */
export interface Extension {
  /** Unique in the list (e.g. `files`); a host replaces a built-in by leaving out the one with this id. */
  readonly id: string;
  /**
   * What the extension declares before any extension is activated (VS Code's `contributes` in an extension's
   * manifest): its settings, commands, keys and languages.
   */
  readonly contributes?: ExtensionContributions;
  /** Registers the extension's contributions; everything it pushes into `context.subscriptions` is disposed with the widget. */
  activate(context: ExtensionContext): void;
}

/** What an extension declares up front (VS Code's `contributes`). */
export interface ExtensionContributions {
  /**
   * Its settings by full id, `<section>.<key>` with the extension's own section (`pdfExport.download`). The host sets
   * values with `createEditor({ settings })`; the extension reads them with `workspace.getConfiguration`.
   */
  readonly configuration?: { readonly properties: Readonly<Record<string, ConfigurationProperty>> };
  /**
   * Its commands for people: what they are called (`commands.getCommands`, e.g. search everywhere's list, which
   * runs them without arguments: declare only commands that work without any).
   */
  readonly commands?: readonly CommandContribution[];
  /**
   * The keys of its commands (VS Code's `contributes.keybindings`): bound for the widget's life, and shown wherever
   * the command is offered (search everywhere, menus, rail buttons).
   */
  readonly keybindings?: readonly KeybindingContribution[];
  /**
   * The languages of files it knows by ending (VS Code's `contributes.languages`): `languages.getLanguageId(path)`
   * reads them, e.g. to pick the help sheet of the shown file. An ending belongs to one language.
   */
  readonly languages?: readonly LanguageContribution[];
}

/**
 * What an extension gets to work with: VS Code's namespaces, the frame, and the hosts of the editors and the preview.
 * Contributions are registered once, at activation; the hosts apply them to every editor they create later.
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
  /** The document links of texts by their language (VS Code's `languages`). */
  readonly languages: Languages;
  /** The project's changes (`applyEdit`) and the settings (VS Code's `workspace` namespace). */
  readonly workspace: Workspace;
  /** The frame: which file is shown, side panels, the editor frame, menus, style sheets, dropped files. */
  readonly workbench: Workbench;
  /** Node and mark specs, toolbar items, gutters, box renderers and editor extensions for every Visual editor. */
  readonly visualEditor: VisualEditorContributions;
  /** CodeMirror extensions for every Source editor. */
  readonly sourceEditor: SourceEditorContributions;
  /** Toolbar items and PDF export options of the preview; reveal and clicks; its compile results (diagnostics, snippets, PDFs). */
  readonly preview: PreviewContributions;
}

/** The widget's frame as extensions see it: showing files, and the places of the frame they can put things. */
export interface Workbench {
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
   * Shows `path` in the editing area (if the project has it), in a custom editor (`window.registerCustomEditorProvider`;
   * a Typst file's are the Visual and the Source editor): the one `viewType` names, else the one the user chose last,
   * else the default one; nothing without one. Opening the shown file again shows it again (an editor without
   * `retainContextWhenHidden` gets the current content in a new panel). `selection` is revealed in that editor
   * (offsets into the file's text; a custom editor gets it as `onDidRequestReveal`).
   */
  open(path: ProjectPath, options?: OpenOptions): void;

  /**
   * Adds `css` where the widget renders (the page's `<head>`, or the shadow root of a `<zwiebelfisch-editor>`), after the
   * widget's own stylesheet, until disposed. An extension styles what it adds this way, under class names of its own,
   * with the colors of the `--zwf-*` tokens (light and dark). Widgets in one root share each stylesheet.
   */
  registerStyleSheet(css: string): Disposable;
  /**
   * Adds a side panel with its rail button on `options.side` (one panel per side is shown at a time); disposing removes
   * both. Ids are unique across both sides; the right side has the preview (`preview`) built in. Each panel has a
   * command `workbench.view.<id>` (VS Code's `workbench.view.explorer`): it shows and focuses the panel, or hides it
   * when it is shown and has the focus (the focus back where it was). The rail button's tooltip names its key.
   */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /**
   * Shows `top` right before and `bottom` right after the shown file's editor, across tab and file switches: in a
   * Typst file's editor inside its content (in the Visual editor below its toolbar), scrolling with it; around any other
   * editor's panel, not scrolling. Detached while no editor is shown. One frame at a time.
   */
  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget and not taken by an editor inside (the Typst editors upload
   * the files dropped into their text themselves). The widget never lets the browser open a dropped file; it shows the
   * drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;

  /**
   * Adds `item` to the menu `menuId` until disposed (VS Code's `contributes.menus`). Whoever shows a menu renders
   * the items whose `when` holds there, sorted by `group` and `order`, and runs an item's command with the menu's
   * arguments. The workbench shows these: `editor/title`, buttons at the right end of the editing area's tab bar, and
   * `view`, the "View" menu after them (context of both: `activeCustomEditorId` (the view type of the editor shown),
   * `resource` (the shown file); no arguments); `workbench/rail/left` and `workbench/rail/right`, a button per item
   * among the side's rail buttons by `order` (as `SidePanelOptions.order`; the tooltip names the key; no context, no
   * arguments). Other ids are menus that extensions show (`window.showContextMenu`), documented there (the file
   * panel: `file/newFile`, `explorer/context`; the Visual editor's: `visualEditor/toolbar` and the others its host
   * documents). `C` is the context the menu is shown in, as that menu documents it.
   */
  registerMenuItem<C extends object = MenuContext>(menuId: string, item: MenuItem<C>): Disposable;
  /** The items of `menuId` to show in `context` (those whose `when` holds), sorted, for whatever shows that menu (or searches it). */
  getMenuItems<C extends object = MenuContext>(menuId: string, context?: C): readonly MenuItem<C>[];
  /** Items of a menu (its id) were registered or disposed. */
  readonly onDidChangeMenu: Event<string>;

  /** Whether the user works in the editing area (the focus is inside it). */
  isEditorFocused(): boolean;
}

export interface OpenOptions {
  /** A range of the file to reveal (offsets into its text). */
  selection?: SourceRange;
  /**
   * The custom editor to open the file in, if it matches the file (its view type, e.g. `sourceEditor`); it is
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
 * Values kept by key (VS Code's Memento), as JSON: what `get` gives is what was stored, so read it as data from
 * outside (check its shape). Without storage (blocked, private window) nothing is kept and nothing fails.
 */
export interface Memento {
  /** The value stored under `key`, else `defaultValue`. */
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  /** Stores `value` (JSON-like) under `key`; `undefined` removes it. */
  update(key: string, value: unknown): Promise<void>;
}

/**
 * The drag data type (`DataTransfer`) of a project file dragged inside the widget, e.g. a row of the file panel; the
 * data is its path. Any editor may take such a drop (the Typst editors insert what the drop edit providers make of it).
 */
export const PROJECT_PATH_TYPE = 'application/x-zwf-project-path';

export interface WorkbenchOptions {
  /**
   * The custom editor the main file opens in (its view type), the user's choice until they pick another tab; default:
   * the one its name picks (for Typst files the Visual editor).
   */
  viewType?: string;
  /** Who works here (`Workbench.user`). */
  user?: User;
  /**
   * The settings' values by full id (the workbench's own `workbench.theme`, and the extensions'), changeable later
   * (`settings`).
   */
  settings?: Settings;
  /** The host's veto on a change someone asked for (`workspace.applyEdit`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /**
   * The widget's color tokens and frame (CSS), put where it renders before the frame is built (the color scheme reads
   * the resolved colors), as `<style id="zwf-editor-styles">` together with the workbench's own CSS. The other
   * hosts' stylesheets follow it, then the extensions'.
   */
  styleSheet?: string;
}

export { WorkbenchHost } from './workbench-impl';
