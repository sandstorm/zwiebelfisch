// createTypstEditor: the widget. A Project in the workbench host (hosts/workbench), with the built-in extensions
// configured from the options. See ARCHITECTURE.md, "createTypstEditor".
// Why the API looks like this: a Typst document is a project of files, and the main file is one of them. So the
// host gives and gets every file through one map (`files`, `onFilesChange`); `source` is only a shortcut for the
// main file's text, for hosts that edit a single file.
import type { CollaborationOptions } from '../extensions/collaboration/collaboration';
import { collaboration } from '../extensions/collaboration/collaboration';
import { comments } from '../extensions/comments/comments';
import { diagnostics } from '../extensions/diagnostics/diagnostics';
import { fileNavigation, files } from '../extensions/files/files';
import { labels } from '../extensions/labels/labels';
import { pdfExport } from '../extensions/pdf-export/pdf-export';
import { previewControls } from '../extensions/preview-controls/preview-controls';
import { previewSync } from '../extensions/preview-sync/preview-sync';
import { spreadsheets } from '../extensions/spreadsheets/spreadsheets';
import { styles } from '../extensions/styles/styles';
import { sourceControl } from '../extensions/source-control/source-control';
import { documentLinks } from '../extensions/document-links/document-links';
import { images } from '../extensions/images/images';
import { renderedBoxes } from '../extensions/rendered-boxes/rendered-boxes';
import { typstLanguage } from '../extensions/typst-language/typst-language';
import { alignment } from '../extensions/alignment/alignment';
import { headings } from '../extensions/headings/headings';
import { lists } from '../extensions/lists/lists';
import { markup } from '../extensions/markup/markup';
import { outline } from '../extensions/outline/outline';
import { pageLayout } from '../extensions/page-layout/page-layout';
import { tables } from '../extensions/tables/tables';
import proseMirrorStyles from '../hosts/visual-view/visual-view.css?inline';
import { type EditorMode, type TypstExtension, WorkbenchHost, workbenchStyles } from '../hosts/workbench/workbench';
import { type FileChange, Project, type ProjectFiles } from '../core/project/project';
import { ProjectPath } from '../core/paths/paths';
import widgetStyles from './typst-editor.css?inline';

export type { CollaborationOptions } from '../extensions/collaboration/collaboration';
export type { EditorMode } from '../hosts/workbench/workbench';
export type { FileChange, FileContent, ProjectFiles } from '../core/project/project';

/**
 * The file panel: `auto` (default) open while the project has more than one file, collapsed to its rail
 * button otherwise (until someone opens or closes it); `show` open; `hide` none at all.
 */
export type FileListMode = 'auto' | 'show' | 'hide';

/** Light or dark colors, or `auto`: as the OS (prefers-color-scheme). */
export type Theme = 'light' | 'dark' | 'auto';

export interface TypstEditorOptions {
  /**
   * The project's files by absolute path, the main file included: `.typ` files (editable, each in its own
   * views), images and data files (shown read-only). `@preview` packages need no entry: they are downloaded
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
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** When the file panel is open (default `auto`: when there is more than one file; see FileListMode). */
  fileList?: FileListMode;
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
  onOpen?(path: string): void;
  /**
   * Whether the preview starts following the cursor ("Follow cursor": it scrolls to the text being
   * edited or selected). Default: what this viewer chose last (remembered in localStorage), else on.
   */
  followCursor?: boolean;
  /** Who works here: the name (and cursor color) others see when collaborating, who commits to GitLab and signs comments. */
  user?: { name: string; color?: string };
  /**
   * Real-time collaboration on the project's Typst files (margin notes
   * included, as they are part of the text): `{ url, room, token? }` connects to a Hocuspocus server (the
   * room's text wins over `source` / `files` once synced; a new room is seeded
   * with them), or `{ doc, awareness? }` shares through a Y.Doc the host has
   * connected (and synced) itself. Images and other files are not shared,
   * except in a room backed by a GitLab branch (`room: 'gitlab:<project>@<branch>'`
   * on a server configured for GitLab): there the server loads the branch,
   * images come from the repository, and "Save to GitLab…" commits.
   */
  collaboration?: CollaborationOptions;
  /**
   * Whether the preview toolbar has "Download PDF" (default true), with a popover of the export options
   * ("Include comments"). Hosts can call `exportPdf` either way.
   */
  pdfDownload?: boolean;
  /**
   * Light or dark colors (default: as the page around the widget, through CSS `color-scheme`: light,
   * unless the page declares dark; `color-scheme: light dark` there follows the OS). In dark mode the
   * preview shows the pages inverted (white text on black); the PDF stays as it is.
   */
  theme?: Theme;
}

/** Which PDF `exportPdf` makes. */
export interface PdfExportOptions {
  /**
   * The export options by id, the others at their default (an id no extension registered rejects). Built in:
   * `comments.include`, the margin notes as the preview shows them (default false: the final version, notes left
   * out).
   */
  options?: Record<string, boolean>;
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
  /** The path of the file shown in the editing area. */
  readonly activeFile: string;
  /** Shows `path` in the editing area (if the project has it). */
  open(path: string): void;
  /**
   * The project as a PDF (`application/pdf`), from the current text, with the export options as given
   * (`{ options: { 'comments.include': true } }`). Rejects with an error naming the problem when the document
   * has errors.
   */
  exportPdf(options?: PdfExportOptions): Promise<Blob>;
  destroy(): void;
}

/**
 * Mounts the editor widget into `host`: an editing view on the left and the
 * live preview on the right. Clicking the preview reveals the source; moving
 * the cursor reveals the spot in the preview. Compiler errors are underlined in
 * the source and counted in a status bar that jumps to the first one. A file
 * panel on the left shows the project as a tree (open with more than one file).
 *
 * Styles go into the root node `host` is attached to: `document.head`, or the
 * shadow root when `host` lives in one. Attach `host` before calling this.
 */
export function createTypstEditor(host: HTMLElement, options: TypstEditorOptions): TypstEditor {
  const main = ProjectPath.of(options.main ?? '/main.typ');
  const project = new Project(main, { ...options.files, ...(options.source === undefined ? {} : { [main]: options.source }) });
  const workbench = new WorkbenchHost(host, project, {
    mode: options.mode,
    theme: options.theme,
    allowFileChange: options.allowFileChange,
    onOpen: options.onOpen,
    // the hosts' and the widget's; each extension adds its own (Workbench.registerStyleSheet)
    styleSheet: proseMirrorStyles + widgetStyles + workbenchStyles,
  });
  workbench.activate(builtinExtensions(options));
  // after the workbench's and the extensions' listeners: the host hears about a change once the widget shows it
  const unsubscribe = project.onChange((change) => options.onFilesChange?.(change));
  const document = project.document(main)!;
  return {
    get files() {
      return project.files();
    },
    set files(next: ProjectFiles) {
      project.replace(next); // listeners hear about every file
      // shown again: a file view shows the new content of a replaced file (a spreadsheet)
      workbench.open(workbench.activeFile);
    },
    get source() {
      return document.text;
    },
    set source(text: string) {
      document.setText(text, 'api');
    },
    get activeFile() {
      return workbench.activeFile;
    },
    open: (path) => {
      const parsed = ProjectPath.parse(path);
      if (parsed) workbench.open(parsed);
    },
    exportPdf: (pdf = {}) => workbench.executeCommand('pdfExport.export', pdf.options),
    destroy: () => {
      unsubscribe();
      workbench.destroy();
      project.destroy();
    },
  };
}

/**
 * The features of the widget and the Typst constructs of the Visual view, in activation order. Extensions never
 * depend on each other; where the Visual view's contributions compete (projectors of the same syntax, box renderers,
 * mark nesting) or document links overlap, their `priority` decides, not this order. The order only places the
 * items of the preview's toolbar, the tab bar and the status bar.
 */
function builtinExtensions(options: TypstEditorOptions): TypstExtension[] {
  return [
    typstLanguage(),
    documentLinks(),
    ...(options.collaboration ? [collaboration(options.collaboration, options.user)] : []),
    files({ fileList: options.fileList }),
    fileNavigation(),
    spreadsheets(),
    diagnostics(),
    sourceControl(),
    markup,
    headings,
    tables,
    images(),
    renderedBoxes(),
    outline,
    pageLayout,
    lists,
    alignment,
    comments({ user: options.user }),
    labels(),
    styles(),
    // the preview's toolbar in this order: "Follow cursor", zoom, page number, then "Download PDF"
    previewSync({ followCursor: options.followCursor }),
    previewControls(),
    pdfExport({ download: options.pdfDownload }),
  ];
}
