import type { Project } from '../../core/project/project';
import type { CommandContribution, Commands, CommandsHost, KeybindingContribution } from '../commands/commands';
import type { LanguageContribution, Languages, LanguagesHost } from '../languages/languages';
import type { PreviewContributions } from '../preview/preview';
import type { Scm } from '../scm/scm';
import type { SourceEditorContributions } from '../source-editor/source-editor';
import type { VisualEditorContributions } from '../visual-editor/visual-editor';
import type { WindowApi, WindowHost } from '../window/window';
import type { ConfigurationProperty, Workspace, WorkspaceHost } from './workspace/workspace';

/**
 * A feature of the widget (VS Code's extension), given to `createEditor({ extensions })`, built-in or a host page's own.
 *
 * The extension host (`ExtensionHost`) runs it: activated once, in list order, after every extension's `contributes`
 * is known and before any editor exists. What it pushes into `context.subscriptions` is disposed with the widget.
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
 * What an extension gets to work with: VS Code's namespaces and the hosts of the editors and the preview.
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
  /**
   * Everything the user sees and interacts with (VS Code's `window`): which file is shown, messages, input, menus, side
   * panels, the title bar, the status bar, editors, the editor header and footer, style sheets, dropped files.
   */
  readonly window: WindowApi;
  /** The source controls (VS Code's `scm`). */
  readonly scm: Scm;
  /** The document links of texts by their language (VS Code's `languages`). */
  readonly languages: Languages;
  /** The project's changes (`applyEdit`) and the settings (VS Code's `workspace` namespace). */
  readonly workspace: Workspace;
  /** Node and mark specs, toolbar items, gutters, box renderers and editor extensions for every Visual editor. */
  readonly visualEditor: VisualEditorContributions;
  /** CodeMirror extensions for every Source editor. */
  readonly sourceEditor: SourceEditorContributions;
  /** Toolbar items and PDF export options of the preview; reveal and clicks; its compile results (diagnostics, snippets, PDFs). */
  readonly preview: PreviewContributions;
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

/** The hosts an extension host gives its extensions, and which take their declarations (`contributes`). */
export interface ExtensionHostOptions {
  readonly project: Project;
  /** Takes the commands and keys extensions declare. */
  readonly commands: CommandsHost;
  /** Takes the commands extensions declare (for menus); its document's storages keep the extensions' mementos. */
  readonly window: WindowHost;
  readonly scm: Scm;
  /** Takes the languages extensions declare. */
  readonly languages: LanguagesHost;
  /** Takes the settings extensions declare, and checks the host's values against them. */
  readonly workspace: WorkspaceHost;
  readonly visualEditor: VisualEditorContributions;
  readonly sourceEditor: SourceEditorContributions;
  readonly preview: PreviewContributions;
}

export { ExtensionHost, StorageMemento } from './extension-host-impl';
