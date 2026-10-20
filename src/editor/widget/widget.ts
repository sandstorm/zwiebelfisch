import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import type { FileChange, Project } from '../../core/project/project';
import type { User } from '../../core/user/user';
import { CommandsHost } from '../../hosts/commands/commands';
import { type Extension, ExtensionHost, StorageMemento } from '../../hosts/extension-host/extension-host';
import { LanguagesHost } from '../../hosts/languages/languages';
import { Preview } from '../../hosts/preview/preview';
import { ScmHost } from '../../hosts/scm/scm';
import { SourceEditorHost } from '../../hosts/source-editor/source-editor';
import { VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import { type TextEditorSelectionChangeEvent, WindowHost } from '../../hosts/window/window';
import { type Settings, WorkspaceHost } from '../../hosts/extension-host/workspace/workspace';
import { registerDocumentDrops } from './document-drops';
import { DocumentEditors } from './document-editors';

/**
 * The widget on `host`: makes and wires the hosts, VS Code's namespaces (`commands`, `window`, `scm`, `languages`,
 * `workspace`) and the editors' and the preview's (`visualEditor`, `sourceEditor`, `preview`), puts the Typst files'
 * editors into the window and its settings onto it, keeps the preview compiling the main file, and runs the extensions
 * (the extension host). Used by:
 * - createEditor
 * - tests of extensions in the composed hosts
 *
 * `activate` starts it: extensions first (their contributions are in place before any editor exists), then the main
 * file is shown and compiled.
 */
export class Widget {
  /** The commands, for the widget's `executeCommand`. */
  readonly commands: CommandsHost;
  /** The window, for the widget's `activeFile` and `open`. */
  readonly window: WindowHost;
  readonly #languages = new LanguagesHost();
  readonly #scm = new ScmHost();
  readonly #workspace: WorkspaceHost;
  readonly #extensions: ExtensionHost;
  readonly #hostStyles: Disposable;
  readonly #sourceEditors = new SourceEditorHost();
  readonly #visualEditor: VisualEditorHost;
  readonly #selectionChanged = new EventEmitter<TextEditorSelectionChangeEvent>();
  readonly #preview: Preview;
  readonly #subscription: Disposable;

  constructor(
    host: HTMLElement,
    private readonly project: Project,
    private readonly options: WidgetOptions = {},
  ) {
    const doc = host.ownerDocument;
    this.#workspace = new WorkspaceHost(project, { settings: options.settings, allowFileChange: options.allowFileChange });
    this.commands = new CommandsHost(host);
    this.window = new WindowHost({
      host,
      project,
      commands: this.commands,
      onDidChangeTextEditorSelection: this.#selectionChanged.event,
      layoutState: StorageMemento.of(doc, 'sessionStorage', `zwf:${project.main}:workbench:`),
      user: options.user,
      styleSheet: options.styleSheet,
    });
    this.#visualEditor = this.#createVisualEditor();
    // the custom editors of `*.typ`, registered before any extension's: they win ties
    new DocumentEditors(project, {
      visualEditor: this.#visualEditor,
      sourceEditors: this.#sourceEditors,
      onSelection: (textEditor) => this.#selectionChanged.fire({ textEditor }),
    }).register(this.window);
    this.#workspace.declare(WORKBENCH_SETTINGS);
    this.#applyWorkbenchSettings();
    this.#preview = this.#createPreview();
    // the hosts' CSS after the window's, before the extensions'
    this.#hostStyles = Disposable.from(...[this.#preview, this.#sourceEditors, this.#visualEditor].map((part) => this.window.registerStyleSheet(part.styleSheet)));
    this.#subscription = Disposable.from(
      project.onDidChangeFile(() => this.#compile()),
      project.onDidChangeMain(() => this.#compile()),
      this.#workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('workbench')) this.#applyWorkbenchSettings();
      }),
    );
    this.#languages.declare([{ id: 'typst', extensions: ['.typ'] }]);
    registerDocumentDrops({
      project,
      languages: this.#languages,
      workspace: this.#workspace,
      window: this.window,
      visualEditor: this.#visualEditor,
      sourceEditor: this.#sourceEditors,
    });
    this.#extensions = new ExtensionHost({
      project,
      commands: this.commands,
      window: this.window,
      scm: this.#scm,
      languages: this.#languages,
      workspace: this.#workspace,
      visualEditor: this.#visualEditor,
      sourceEditor: this.#sourceEditors,
      preview: this.#preview,
    });
  }

  /**
   * Runs `extensions` (the extension host: their declarations, then each one's activation, in order), then shows the
   * main file and compiles it. Once.
   */
  activate(extensions: readonly Extension[]): void {
    this.#extensions.activate(extensions);
    this.window.showDocument(this.project.main, { viewType: this.options.viewType });
    this.#compile();
  }

  /** The settings' values the host set, by full id. */
  get settings(): Settings {
    return this.#workspace.values;
  }

  /** Merges `settings` into them (`undefined` resets an id to its default); listeners hear what changed. */
  updateSettings(settings: Settings): void {
    this.#workspace.update(settings);
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#extensions.dispose();
    this.#scm.dispose();
    this.#preview.dispose();
    this.#hostStyles.dispose();
    this.window.dispose();
    this.#selectionChanged.dispose();
    this.commands.dispose();
    this.#workspace.dispose();
  }

  /** The Visual editor: its raw boxes' code takes the CodeMirror contributions (`editor: 'rawBox'`, as Typst in its file); its toolbar the window's menus. */
  #createVisualEditor(): VisualEditorHost {
    return new VisualEditorHost({
      rawBoxCodeMirrorExtensions: ({ document }) =>
        this.#sourceEditors.codeMirrorExtensionsFor({ editor: 'rawBox', languageId: 'typst', path: () => this.project.pathOf(document) ?? null, document }),
      menus: {
        getMenuItems: (menuId, context) => this.window.getMenuItems(menuId, context),
        onDidChangeMenu: (listener) => this.window.onDidChangeMenu(listener),
        executeCommand: (command, ...args) => this.commands.executeCommand(command, ...args),
        keybindingLabel: (command) => this.commands.keybindingLabel(command),
      },
    });
  }

  /**
   * The preview, in the right side's built-in panel `preview` (registered before any extension, so first among equal
   * orders), its toolbar the window's menu `preview/title`. It compiles whether shown or not: diagnostics, raw box snippets and the selection highlight never wait
   * for it to be shown.
   */
  #createPreview(): Preview {
    const panel = this.window.registerSidePanel('preview', { label: 'Preview', icon: PREVIEW_ICON, side: 'right' });
    return new Preview(panel.body, {
      menus: {
        getMenuItems: (menuId, context) => this.window.getMenuItems(menuId, context),
        onDidChangeMenu: (listener) => this.window.onDidChangeMenu(listener),
        onDidChangeConfiguration: (listener) => this.#workspace.onDidChangeConfiguration(listener),
        executeCommand: (command, ...args) => this.commands.executeCommand(command, ...args),
        keybindingLabel: (command) => this.commands.keybindingLabel(command),
      },
    });
  }

  /** The window's theme and right side panel from the settings `workbench.theme` and `workbench.rightSidePanel`. */
  #applyWorkbenchSettings(): void {
    const workbench = this.#workspace.getConfiguration('workbench');
    this.window.setTheme(workbench.get<'light' | 'dark' | 'auto' | null>('theme') ?? null);
    this.window.setDefaultSidePanel(workbench.get<string | null>('rightSidePanel') ?? null);
  }

  #compile(): void {
    this.#preview.update(this.project.files(), this.project.main);
  }
}

/** What the widget is made with besides the project. */
export interface WidgetOptions {
  /**
   * The custom editor the main file opens in (its view type), the user's choice until they pick another tab; default:
   * the one its name picks (for Typst files the Visual editor).
   */
  viewType?: string;
  /** Who works here (`window.user`). */
  user?: User;
  /**
   * The settings' values by full id (the window's `workbench.theme` and `workbench.rightSidePanel`, and the extensions'), changeable later
   * (`updateSettings`).
   */
  settings?: Settings;
  /** The host's veto on a change someone asked for (`workspace.applyEdit`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /**
   * The widget's color tokens and frame (CSS), put where it renders before the frame is built (the color scheme reads
   * the resolved colors), as `<style id="zwf-editor-styles">` together with the window's layout CSS. The other
   * hosts' stylesheets follow it, then the extensions'.
   */
  styleSheet?: string;
}

/** The window's settings. */
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

/** The preview's rail button's icon: a page. */
const PREVIEW_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3M6.5 8h4M6.5 10.5h4"/></svg>';
