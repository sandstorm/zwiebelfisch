// See ExtensionContext in workbench.ts.
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import type { Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { uploadChanges, uploadTarget } from '../../core/uploads/uploads';
import { CommandsHost } from '../commands/commands';
import { LanguagesHost } from '../languages/languages';
import { Preview } from '../preview/preview';
import { ScmHost } from '../scm/scm';
import { SourceEditorHost } from '../source-editor/source-editor';
import { VisualEditorHost } from '../visual-editor/visual-editor';
import { WindowHost } from '../window/window';
import { type Settings, WorkspaceHost } from '../workspace/workspace';
import { type DocumentDrops, sourceEditorDrops, visualEditorDrops } from './document-drops/document-drops';
import { ExtensionHost } from './extension-host/extension-host';
import { StorageMemento } from './memento/memento';
import type { Extension, WorkbenchOptions } from './workbench';

/**
 * The widget on `host`: makes the hosts, VS Code's namespaces (`commands`, `window`, `scm`, `languages`, `workspace`)
 * and the editors' and the preview's (`visualEditor`, `sourceEditor`, `preview`), keeps the preview compiling the main
 * file, and runs the extensions. `activate` starts it: extensions first (their contributions are in place before any
 * editor exists), then the main file is shown and compiled. createEditor creates it.
 */
export class WorkbenchHost {
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
  /** Its raw boxes' code takes the CodeMirror contributions (`editor: 'rawBox'`, as Typst in its file); its toolbar the window's menus. */
  readonly #visualEditor = new VisualEditorHost({
    rawBoxCodeMirrorExtensions: ({ document }) =>
      this.#sourceEditors.codeMirrorExtensionsFor({ editor: 'rawBox', languageId: 'typst', path: () => this.project.pathOf(document) ?? null, document }),
    menus: {
      getMenuItems: (menuId, context) => this.window.getMenuItems(menuId, context),
      onDidChangeMenu: (listener) => this.window.onDidChangeMenu(listener),
      executeCommand: (command, ...args) => this.commands.executeCommand(command, ...args),
      keybindingLabel: (command) => this.commands.keybindingLabel(command),
    },
  });
  readonly #preview: Preview;
  readonly #subscription: Disposable;

  constructor(
    host: HTMLElement,
    private readonly project: Project,
    private readonly options: WorkbenchOptions = {},
  ) {
    const doc = host.ownerDocument;
    this.#workspace = new WorkspaceHost(project, { settings: options.settings, allowFileChange: options.allowFileChange });
    this.commands = new CommandsHost(host);
    this.window = new WindowHost({
      host,
      project,
      commands: this.commands,
      workspace: this.#workspace,
      visualEditor: this.#visualEditor,
      sourceEditor: this.#sourceEditors,
      layoutState: StorageMemento.of(doc, 'sessionStorage', `zwf:${project.main}:workbench:`),
      user: options.user,
      styleSheet: options.styleSheet,
    });
    this.#preview = this.#createPreview();
    // the hosts' CSS after the window's, before the extensions'
    this.#hostStyles = Disposable.from(...[this.#preview, this.#sourceEditors, this.#visualEditor].map((part) => this.window.registerStyleSheet(part.styleSheet)));
    this.#subscription = Disposable.from(project.onDidChangeFile(() => this.#compile()), project.onDidChangeMain(() => this.#compile()));
    this.#extendEditors();
    this.#extensions = new ExtensionHost(
      {
        project,
        commands: this.commands,
        window: this.window,
        scm: this.#scm,
        languages: this.#languages,
        workspace: this.#workspace,
        visualEditor: this.#visualEditor,
        sourceEditor: this.#sourceEditors,
        preview: this.#preview,
      },
      (id) => ({
        globalState: StorageMemento.of(doc, 'localStorage', `zwf:global:${id}:`),
        workspaceState: StorageMemento.of(doc, 'sessionStorage', `zwf:${project.main}:${id}:`),
      }),
    );
  }

  /**
   * Declares the settings, keys and languages of `extensions`, activates them (in order), then shows the main file and compiles it. Once.
   * Values set for settings no one declares are reported (console) and ignored.
   */
  activate(extensions: readonly Extension[]): void {
    for (const extension of extensions) {
      this.#workspace.declare(extension.contributes?.configuration?.properties ?? {});
      this.#languages.declare(extension.contributes?.languages ?? []);
      this.commands.declareKeybindings(extension.contributes?.keybindings);
      this.commands.declareCommands(extension.contributes?.commands);
      this.window.declareCommands(extension.contributes?.commands);
    }
    this.#workspace.check();
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
    this.commands.dispose();
    this.#workspace.dispose();
  }

  /**
   * The preview, in the right side's built-in panel `preview` (registered before any extension, so first among equal
   * orders). It compiles whether shown or not: diagnostics, raw box snippets and the selection highlight never wait
   * for it to be shown.
   */
  #createPreview(): Preview {
    const panel = this.window.registerSidePanel('preview', { label: 'Preview', icon: PREVIEW_ICON, side: 'right' });
    return new Preview(panel.body);
  }

  /**
   * The Typst files' language, `typst` (`.typ`). A project file (a row of the file panel) dropped into a Visual or
   * Source editor becomes what the drop edit providers (`languages.registerDocumentDropEditProvider`) make of it,
   * inserted where it was dropped; so does a file from the computer, once uploaded (`#upload`): the providers know only
   * project files.
   */
  #extendEditors(): void {
    this.#languages.declare([{ id: 'typst', extensions: ['.typ'] }]);
    const drops: DocumentDrops = {
      edit: (document, offset, file) => {
        const path = this.project.pathOf(document);
        return path ? this.#languages.provideDocumentDropEdit({ path, languageId: 'typst', text: document.text }, offset, file) : null;
      },
      upload: (document, files) => this.#upload(document, files),
    };
    this.#visualEditor.registerTiptapExtension(({ document }) => visualEditorDrops(document, drops));
    this.#sourceEditors.registerCodeMirrorExtension({ editor: 'source' }, (editor) => (editor.editor === 'source' ? sourceEditorDrops(editor.document, drops) : []));
  }

  /**
   * Adds `files` from the computer, dropped into `document`, to the project (`workspace.applyEdit`), each in the folder
   * the drop edit providers name (`languages.provideUploadFolder`; default: the top) under its name, or under the
   * first free one of `name-2.ext`, … unless a file of that name has the same content (`uploadTarget`); a refusal is
   * an error message. Resolves to the files' paths in the project, without the refused ones.
   */
  async #upload(document: TypstDocument, files: File[]): Promise<ProjectPath[]> {
    const paths: ProjectPath[] = [];
    const file = this.project.pathOf(document);
    const text = { path: file!, languageId: 'typst', text: document.text };
    for (const change of await uploadChanges(files)) {
      if (change.kind !== 'create') continue;
      const folder = file ? this.#languages.provideUploadFolder(text, change.path) : '/';
      const named = ProjectPath.of(folder + ProjectPath.name(change.path));
      const path = uploadTarget(named, change.content, (candidate) => this.project.content(candidate));
      const problem = this.project.has(path) ? null : await this.#workspace.applyEdit({ ...change, path });
      if (problem) void this.window.showErrorMessage(problem);
      else paths.push(path);
    }
    return paths;
  }

  #compile(): void {
    this.#preview.update(this.project.files(), this.project.main);
  }
}

/** The preview's rail button's icon: a page. */
const PREVIEW_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3M6.5 8h4M6.5 10.5h4"/></svg>';
