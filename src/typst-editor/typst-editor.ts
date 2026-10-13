import { comments } from '../extensions/comments/comments';
import { devtools } from '../extensions/devtools/devtools';
import { diagnostics } from '../extensions/diagnostics/diagnostics';
import { diagrams } from '../extensions/diagrams/diagrams';
import { mermaid } from '../extensions/mermaid/mermaid';
import { fileNavigation } from '../extensions/file-navigation/file-navigation';
import { files } from '../extensions/files/files';
import { help } from '../extensions/help/help';
import { imports } from '../extensions/imports/imports';
import { markdown } from '../extensions/markdown/markdown';
import { wordProcessors } from '../extensions/word-processors/word-processors';
import { labels } from '../extensions/labels/labels';
import { pdfExport } from '../extensions/pdf-export/pdf-export';
import { previewControls } from '../extensions/preview-controls/preview-controls';
import { previewGuides } from '../extensions/preview-guides/preview-guides';
import { previewSync } from '../extensions/preview-sync/preview-sync';
import { spreadsheets } from '../extensions/spreadsheets/spreadsheets';
import { textFiles } from '../extensions/text-files/text-files';
import { styles } from '../extensions/styles/styles';
import { slashCommands } from '../extensions/slash-commands/slash-commands';
import { sourceControl } from '../extensions/source-control/source-control';
import { documentLinks } from '../extensions/document-links/document-links';
import { images } from '../extensions/images/images';
import { invisibles } from '../extensions/invisibles/invisibles';
import { figures } from '../extensions/figures/figures';
import { renderedBoxes } from '../extensions/rendered-boxes/rendered-boxes';
import { typstLanguage } from '../extensions/typst-language/typst-language';
import { alignment } from '../extensions/alignment/alignment';
import { headings } from '../extensions/headings/headings';
import { lists } from '../extensions/lists/lists';
import { markup } from '../extensions/markup/markup';
import { math } from '../extensions/math/math';
import { outline } from '../extensions/outline/outline';
import { pageLayout } from '../extensions/page-layout/page-layout';
import { tables } from '../extensions/tables/tables';
import { type TypstExtension, WorkbenchHost } from '../hosts/workbench/workbench';
import type { Settings } from '../hosts/workspace/workspace';
import type { User } from '../core/user/user';
import { type FileChange, Project, type ProjectFiles } from '../core/project/project';
import { ProjectPath } from '../core/paths/paths';
import widgetStyles from './typst-editor.css?inline';

/**
 * Mounts the editor widget into `host`: the editors and the live preview of a project of Typst files.
 *
 * The widget is a Project in the workbench (hosts/workbench) with the built-in extensions (`builtinExtensions()`, or
 * the list `extensions` makes from them) and the host's settings. The workbench and the hosts are only mechanism; every
 * feature (the file panel, the preview following the cursor, errors, PDF export, …) is one of those extensions. The
 * devtools wrap the final list, so they record every extension's contributions, the host's too.
 *
 * A Typst document is a project of files, and the main file is one of them. So the host gives and gets every file
 * through one map (`files`, `onFilesChange`); `source` is only a shortcut for the main file's text. What a feature lets
 * the host configure is a setting its extension declares (`settings: { 'pdfExport.download': false }`), so the
 * options stay the same when features come and go. `<typst-editor>` wraps this function as a custom element.
 *
 * Styles go into the root node `host` is attached to: `document.head`, or the shadow root `host` lives in. Attach
 * `host` before calling this. See docs/30_configuration/02_embedding.typ, "createTypstEditor".
 */
export function createTypstEditor(host: HTMLElement, options: TypstEditorOptions): TypstEditor {
  const main = ProjectPath.of(options.main ?? '/main.typ');
  const project = new Project(main, { ...options.files, ...(options.source === undefined ? {} : { [main]: options.source }) });
  const workbench = new WorkbenchHost(host, project, {
    viewType: options.viewType,
    user: options.user,
    settings: options.settings,
    allowFileChange: options.allowFileChange,
    onOpen: options.onOpen,
    // the tokens and the frame; the workbench adds the hosts', each extension its own (registerStyleSheet)
    styleSheet: widgetStyles,
  });
  const builtins = builtinExtensions();
  workbench.activate(devtools(options.extensions?.(builtins) ?? builtins));
  // after the workbench's and the extensions' listeners: the host hears about a change once the widget shows it
  const subscription = project.onDidChangeFile((change) => options.onFilesChange?.(change));
  const document = project.document(main)!;
  return {
    get files() {
      return project.files();
    },
    set files(next: ProjectFiles) {
      project.replace(next); // listeners hear about every file
      // shown again: a custom editor shows the new content of a replaced file (a spreadsheet)
      workbench.open(workbench.window.activeFile);
    },
    get source() {
      return document.text;
    },
    set source(text: string) {
      project.apply({ kind: 'update', path: main, content: text });
    },
    get settings() {
      return workbench.settings;
    },
    set settings(settings: Settings) {
      workbench.settings = settings;
    },
    get activeFile() {
      return workbench.window.activeFile;
    },
    open: (path) => {
      const parsed = ProjectPath.parse(path);
      if (parsed) workbench.open(parsed);
    },
    executeCommand: (id, ...args) => workbench.commands.executeCommand(id, ...args),
    exportPdf: (options) => workbench.commands.executeCommand('pdfExport.export', options),
    dispose: () => {
      subscription.dispose();
      workbench.dispose();
      project.dispose();
    },
  };
}

export interface TypstEditorOptions {
  /**
   * The project's files by absolute path, the main file included: `.typ` files (editable, each in its own
   * editors), images and data files (shown read-only). `@preview` packages need no entry: they are downloaded
   * on first import.
   */
  files?: ProjectFiles;
  /** Path of the main file (default `/main.typ`). It is compiled, and cannot be renamed or deleted. */
  main?: string;
  /**
   * Shortcut for the main file's text, for hosts with a single file: wins over `files[main]`. Without either,
   * the main file starts empty.
   */
  source?: string;
  /**
   * The editor the main file opens in, by view type: `SOURCE_EDITOR` (`'sourceEditor'`) or
   * `VISUAL_EDITOR` (`'visualEditor'`, the default). Typst files open in it until the user picks the other tab.
   */
  viewType?: string;
  /**
   * Decides whether a create / rename / delete / upload someone asked for in
   * the file panel may happen (default: all may). May be async, e.g. to ask a server.
   */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /**
   * Called after every change to any file, the main file included: edits (`update`, with the full text),
   * create / rename / delete, the collaborators' changes and assignments to `files` / `source`.
   */
  onFilesChange?(change: FileChange): void;
  /** Called when another file is shown in the editing area (e.g. to put it into the page URL). */
  onOpen?(path: ProjectPath): void;
  /** Who works here: the name (and cursor color) others see when collaborating, who commits to GitLab and signs comments. */
  user?: User;
  /**
   * The settings by full id, as the extensions declare them, e.g. `{ 'pdfExport.download': false, 'files.panel':
   * 'show', 'workbench.theme': 'dark' }` (see docs/30_configuration/01_options.typ for the built-in ones). Unset ones have their
   * default; unknown ids and values of the wrong type are ignored (with a console warning). Changeable later through
   * `TypstEditor.settings`.
   */
  settings?: Settings;
  /**
   * The extensions to run, made from the built-in ones (in their order): add yours (`(builtinExtensions) => [...builtinExtensions,
   * mine]`), leave one out or replace it (`builtinExtensions.filter((e) => e.id !== 'pdf-export')`). Default: the built-ins.
   * The devtools come after them in any case; the setting `devtools.enabled` removes their panel.
   */
  extensions?(builtinExtensions: readonly TypstExtension[]): readonly TypstExtension[];
}

export interface TypstEditor {
  /**
   * Every file of the project, the main file included, with its current content. Assigning replaces them all
   * (reported through `onFilesChange`) and recompiles; the main file cannot be deleted, so without an entry
   * for it it keeps its text.
   */
  files: ProjectFiles;
  /**
   * Shortcut for the main file's text (`files[main]`). Assigning replaces it as one minimal edit (only the
   * differing middle changes), reported through `onFilesChange` as an `update`.
   */
  source: string;
  /**
   * The settings the host set, by full id. Assigning replaces them (ids left out go back to their default); the
   * extensions follow at once.
   */
  settings: Settings;
  /** The path of the file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /** Shows `path` in the editing area (if the project has it). */
  open(path: string): void;
  /**
   * Runs the command `id` an extension registered (e.g. `comments.addComment`), with `args`; resolves to its result,
   * rejects for an unknown id or when the command fails.
   */
  executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  /**
   * The project as a PDF (`application/pdf`), from the current text, with the export options by id, the others at
   * their default (`{ 'comments.include': true }`; an id no extension registered rejects). Built in:
   * `comments.include`, the margin notes as the preview shows them (default false: the final version, notes left
   * out). The one feature shortcut on the widget: the command `pdfExport.export`. Rejects with an error naming the
   * problem when the document has errors.
   */
  exportPdf(options?: Record<string, boolean>): Promise<Blob>;
  dispose(): void;
}

/**
 * The features of the widget and the Typst constructs of the Visual editor. Extensions never depend on each other, and
 * the order carries no meaning: where contributions compete their `priority` decides (box renderers, overlapping
 * document links, custom editors; for parse rules of the same syntax and mark nesting, that of the specs' Tiptap
 * extensions); toolbar and menu items (the tab bar's too) have a `group` + `order`, status bar items an `alignment` +
 * `priority`. Collaboration is not among them: the host adds it with its connection. Nor are the devtools: they wrap
 * the final list (createTypstEditor).
 */
function builtinExtensions(): TypstExtension[] {
  return [
    typstLanguage(),
    imports(),
    markdown(),
    wordProcessors(),
    documentLinks(),
    files(),
    fileNavigation(),
    help(),
    spreadsheets(),
    textFiles(),
    diagrams(),
    mermaid(),
    diagnostics(),
    sourceControl(),
    markup(),
    math(),
    headings(),
    tables(),
    images(),
    figures(),
    renderedBoxes(),
    outline(),
    pageLayout(),
    lists(),
    alignment(),
    comments(),
    labels(),
    styles(),
    invisibles(),
    slashCommands(),
    previewSync(),
    previewControls(),
    previewGuides(),
    pdfExport(),
  ];
}
