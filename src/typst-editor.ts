// createTypstEditor: the widget. Composes a Project, the editing views (typst-editor/editing-views.ts), the
// preview, the file panel (in typst-editor/layout.ts), the status bar and the features. See ARCHITECTURE.md, "createTypstEditor".
// Why the API looks like this: a Typst document is a project of files, and the main file is one of them. So the
// host gives and gets every file through one map (`files`, `onFilesChange`); `source` is only a shortcut for the
// main file's text, for hosts that edit a single file.
import type { CollaborationOptions } from './features/collaboration/collaboration';
import type { Diagnostic } from './core/typst-engine/typst-engine';
import type { TypstDocument } from './core/typst-document/typst-document';
import { followCursor, pageNumber, pdfMenu, Preview, zoomControls } from './hosts/preview/preview';
import { codeColors, DiagnosticCollection, fileLinks, lint, presence, SourceViewHost, typstLanguage } from './hosts/source-view/source-view';
import proseMirrorStyles from './features/visual-view/visual-view.css?inline';
import { AssetView, FilePanel, filesPanelIcon } from './features/files/files';
import fileStyles from './features/files/files.css?inline';
import { CommentAction } from './features/comments/comments';
import { ColorScheme } from './typst-editor/color-scheme';
import { CollaborationLink } from './typst-editor/collaboration-link';
import { DiagnosticsStatus, summarizeDiagnostics } from './features/diagnostics/diagnostics';
import { EditingViews, type EditorMode } from './typst-editor/editing-views';
import { Layout } from './typst-editor/layout';
import layoutStyles from './typst-editor/layout.css?inline';
import { type FileChange, Project, type ProjectFiles } from './core/project/project';
import { ProjectPath } from './core/paths/paths';
import { DocumentLinkProvider, neighbours } from './core/document-links/document-links';
import { FileNavigation } from './typst-editor/file-navigation';
import { PdfExport } from './typst-editor/pdf-export';
import { ProjectRenderings } from './typst-editor/project-renderings';
import { LabelIndex } from './features/labels/labels';
import { newStyle, StyleIndex } from './features/styles/styles';
import { SpreadsheetView, typstPath, type WorkbookEdit } from './features/spreadsheets/spreadsheets';
import styles from './typst-editor.css?inline';
import { VersionControls, type Versions } from './features/versions/versions';

export type { CollaborationOptions } from './features/collaboration/collaboration';
export type { EditorMode } from './typst-editor/editing-views';
export type { FileChange, FileContent, ProjectFiles } from './core/project/project';

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
  /** Who works here: the name (and cursor color) others see when collaborating, who saves versions and signs comments. */
  user?: { name: string; color?: string };
  /**
   * Real-time collaboration on the project's Typst files (margin notes
   * included, as they are part of the text): `{ url, room, token? }` connects to a Hocuspocus server (the
   * room's text wins over `source` / `files` once synced; a new room is seeded
   * with them), or `{ doc, awareness? }` shares through a Y.Doc the host has
   * connected (and synced) itself. Images and other files are not shared,
   * except in a room backed by a GitLab branch (`room: 'gitlab:<project>@<branch>'`
   * on a server configured for GitLab): there the server loads the branch,
   * images come from the repository, and a "Save version" button commits.
   */
  collaboration?: CollaborationOptions;
  /**
   * Whether the preview toolbar has "Download PDF" (default true): without
   * comments, or with them from its menu. Hosts can call `exportPdf` either way.
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
  /** With the margin notes as the preview shows them (default false: the final version, notes left out). */
  comments?: boolean;
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
   * The project as a PDF (`application/pdf`), from the current text. Rejects
   * with an error naming the problem when the document has errors.
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
  const widget = new Widget(host, options);
  const main = widget.project.document(widget.project.main)!;
  return {
    get files() {
      return widget.project.files();
    },
    set files(next: ProjectFiles) {
      widget.replaceFiles(next);
    },
    get source() {
      return main.text;
    },
    set source(text: string) {
      main.setText(text, 'api');
    },
    get activeFile() {
      return widget.active;
    },
    open: (path) => {
      const parsed = ProjectPath.parse(path);
      if (parsed) widget.open(parsed);
    },
    exportPdf: (options = {}) => widget.pdfs.blob(options.comments ?? false),
    destroy: () => widget.destroy(),
  };
}

/** The composition: which file is shown where, and who hears about what. */
class Widget {
  readonly project: Project;
  /** The file shown in the editing area. */
  active: ProjectPath;
  /** The Typst file shown last: where images are inserted and whose diagnostics the status counts. */
  private lastSource: ProjectPath;
  private diagnostics: Diagnostic[] | null = null;
  private readonly layout: Layout;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly status: DiagnosticsStatus;
  private readonly preview: Preview;
  readonly pdfs: PdfExport;
  private readonly sourceViews = new SourceViewHost();
  /** The diagnostics the Source views underline (their `lint` contribution). */
  private readonly sourceDiagnostics = new DiagnosticCollection();
  private readonly views: EditingViews;
  private readonly navigation: FileNavigation;
  private readonly files: FilePanel;
  private readonly assets: AssetView;
  private readonly spreadsheets: SpreadsheetView;
  private readonly renderings: ProjectRenderings;
  private readonly labels: LabelIndex;
  private readonly styles: StyleIndex;
  private readonly commentAction: CommentAction;
  private readonly scheme: ColorScheme;
  private readonly collaboration: CollaborationLink | null = null;
  private versions: VersionControls | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: TypstEditorOptions,
  ) {
    injectStyles(host);
    const main = ProjectPath.of(options.main ?? '/main.typ');
    const files = { ...options.files, ...(options.source === undefined ? {} : { [main]: options.source }) };
    this.project = new Project(main, files);
    this.active = this.lastSource = main;
    host.classList.add('typst-editor');
    if (options.theme) host.dataset.theme = options.theme;
    this.scheme = new ColorScheme(host);
    this.layout = new Layout(host, `typst-editor:${main}`);
    this.left = this.layout.editor;
    this.right = this.layout.preview;

    this.status = new DiagnosticsStatus(host, (target) => this.jump(target, true));
    this.preview = new Preview(this.right, {
      onJump: (jump) => this.jump(jump),
      onDiagnostics: (diagnostics) => this.showDiagnostics(diagnostics),
    });
    this.pdfs = new PdfExport(this.project, this.preview);
    this.registerPreviewContributions();
    this.registerSourceViewContributions();
    this.labels = new LabelIndex(this.project);
    this.styles = new StyleIndex(this.project);
    this.renderings = new ProjectRenderings({ project: this.project, preview: this.preview, request: (change) => this.request(change) });
    this.views = this.mountViews();
    this.navigation = new FileNavigation(host.ownerDocument, (path) => this.open(path));
    this.views.setFrame(this.navigation.top, this.navigation.bottom);
    // Drops anywhere on the widget (also the preview): never the browser opening the file instead.
    const filesBody = this.layout.addPanel('files', { label: 'Files', icon: filesPanelIcon(host.ownerDocument) });
    this.files = new FilePanel(filesBody, host, {
      onOpen: (path) => {
        this.open(path);
        this.layout.dismiss();
      },
      onChange: (change) => this.request(change),
      memory: this.layout.remember('folders'),
    }, { paths: this.project.paths(), main, active: main });
    this.assets = new AssetView(this.left);
    this.spreadsheets = new SpreadsheetView(this.left, (path, edit) => this.saveSpreadsheet(path, edit));
    this.unsubscribe = this.project.onChange((change) => this.changed(change));
    // the Visual view has "Comment" in its toolbar; the tab bar's button is for the Source view
    this.commentAction = new CommentAction(host, () => this.views.shown());
    this.views.addTabAction(this.commentAction.button, 'source');
    this.open(main);
    if (options.collaboration) {
      this.collaboration = this.mountCollaboration(options.collaboration);
      this.showCursors();
    }
    this.refresh();
  }

  open(path: ProjectPath): void {
    if (!this.project.has(path)) return;
    const changed = path !== this.active;
    this.active = path;
    const document = this.project.document(path);
    const spreadsheet = ProjectPath.kind(path) === 'spreadsheet';
    if (document) this.lastSource = path;
    if (document || spreadsheet) this.assets.hide();
    else this.assets.show(path, this.project.content(path)!);
    // reopened on every open: a spreadsheet changed elsewhere (replaced files) shows its new content
    if (spreadsheet) void this.spreadsheets.show(path, this.project.content(path)!);
    else this.spreadsheets.hide();
    this.views.show(document ?? null);
    this.showNeighbours();
    this.showCursors();
    this.renderFiles();
    this.showStatus();
    if (changed) this.options.onOpen?.(path);
  }

  /** The preview's toolbar (zoom, "Follow cursor", page number, "Download PDF") and the PDFs it offers. */
  private registerPreviewContributions(): void {
    const follow = { on: this.options.followCursor ?? rememberedFollow() ?? true, onChange: rememberFollow };
    for (const item of [zoomControls, followCursor(follow), pageNumber]) this.preview.registerToolbarItem(item);
    if (this.options.pdfDownload !== false) this.preview.registerToolbarItem(pdfMenu);
    // the plain "Download PDF" makes the first: the usual final version
    this.preview.registerPdfVariant({ label: 'Without comments', create: () => this.pdfs.file(false) });
    this.preview.registerPdfVariant({ label: 'With comments', create: () => this.pdfs.file(true) });
  }

  /** What every Source view has: Typst syntax and colors, other users' carets, file links, compile errors. */
  private registerSourceViewContributions(): void {
    for (const extension of [codeColors, typstLanguage(), presence, fileLinks, lint(this.sourceDiagnostics)]) {
      this.sourceViews.registerExtension(extension);
    }
    this.sourceViews.registerLinkProvider((document) => this.documentLinks(document));
  }

  /** The Visual/Source views of every document, wired to the preview, collaboration and file links. */
  private mountViews(): EditingViews {
    return new EditingViews(this.left, {
      mode: this.options.mode,
      sourceViews: this.sourceViews,
      visualOptions: (document) => ({
        ...this.renderings.forDocument(document),
        user: this.options.user,
        comment: () => this.commentAction.comment(),
        labels: this.labels,
        styles: { ...this.styles.forDocument(document), create: () => void this.newStyle() },
      }),
      documentLinks: (document) => this.documentLinks(document),
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) void this.preview.reveal(path, offset);
      },
      // Publish the local selection from the editors' own updates: the DOM's selectionchange
      // fires before CodeMirror/ProseMirror read the new selection, so it would publish the previous one.
      onSelection: () => this.collaboration?.selectionChanged(),
    });
  }

  /** Shares the project; the others' carets show in the shown file's views and the file panel. */
  private mountCollaboration(options: CollaborationOptions): CollaborationLink {
    const shared = { project: this.project, user: this.options.user };
    const current = () => {
      const document = this.project.document(this.active);
      if (!document) return null;
      const views = this.views.viewsOf(document);
      return { path: this.active, view: this.views.mode === 'visual' ? views.visual : views.source };
    };
    return new CollaborationLink(options, shared, this.left, {
      current,
      onVersions: (versions) => this.mountVersions(versions),
      // Where the others are, in every file: dots in the file panel.
      onPresence: (presences) => this.files.showPresence(presences),
    });
  }

  /** "Save version" next to the tabs, in a room backed by a GitLab branch. */
  private mountVersions(versions: Versions): void {
    const toolbar = this.host.ownerDocument.createElement('span');
    toolbar.className = 'typst-editor__tab-actions';
    this.views.addTabAction(toolbar);
    this.versions = new VersionControls(toolbar, versions, { user: this.options.user });
  }

  private showCursors(): void {
    const document = this.project.document(this.active);
    const views = document ? this.views.viewsOf(document) : null;
    this.collaboration?.show(views ? this.active : null, views ? [views.visual, views.source] : []);
  }

  replaceFiles(files: ProjectFiles): void {
    this.project.replace(files); // listeners (also `changed`) hear about every file
    // shown again: a file view shows the new content of a replaced file (a spreadsheet)
    this.open(this.active);
  }

  destroy(): void {
    this.unsubscribe();
    this.versions?.destroy();
    this.collaboration?.destroy();
    this.commentAction.destroy();
    this.views.destroy();
    this.files.destroy();
    this.assets.destroy();
    this.spreadsheets.destroy();
    this.renderings.destroy();
    this.labels.destroy();
    this.styles.destroy();
    this.preview.destroy();
    this.status.destroy();
    this.project.destroy();
    this.host.classList.remove('typst-editor');
    delete this.host.dataset.theme;
    this.scheme.destroy();
    this.layout.destroy();
  }

  private refresh(): void {
    this.preview.update(this.project.files(), this.project.main);
  }

  private changed(change: FileChange): void {
    this.refresh();
    this.showNeighbours(); // an #include may have been added, moved or removed
    if (change.kind !== 'update') this.restructured(change);
    this.options.onFilesChange?.(change);
  }

  /** Keeps `active` and `lastSource` pointing at existing files after a create / rename / delete. */
  private restructured(change: FileChange): void {
    const follow = (path: ProjectPath) => {
      if (change.kind === 'rename' && change.from === path) return change.path;
      return this.project.has(path) ? path : this.project.main;
    };
    this.views.retain(this.documents());
    this.lastSource = follow(this.lastSource);
    this.open(follow(this.active));
  }

  /** Applies a change asked for in the file panel (or a link), if the project and the host allow it. */
  private async request(change: FileChange): Promise<string | null> {
    const problem = this.project.check(change);
    if (problem) return problem;
    const allowed = (await this.options.allowFileChange?.(change)) ?? true;
    if (!allowed) return 'This change is not allowed here.';
    // The project may have changed while the host decided.
    const late = this.project.check(change);
    if (late) return late;
    this.project.apply(change);
    return null;
  }

  /** The links of `document`: its paths resolve from its current path and open here. */
  private documentLinks(document: TypstDocument): DocumentLinkProvider {
    return new DocumentLinkProvider({
      resolve: (reference) => {
        const file = this.project.pathOf(document);
        return file ? ProjectPath.resolve(file, reference) : null;
      },
      exists: (path) => this.project.has(path),
      open: (path) => this.open(path),
      create: async (path) => {
        const problem = await this.request({ kind: 'create', path, content: '' });
        if (problem === null) this.open(path);
        return problem;
      },
    });
  }

  /**
   * "New style…": appends a paragraph style to start from to the file holding most styles (else
   * `/styles.typ`, created when missing) and shows it in the Source view.
   */
  private async newStyle(): Promise<void> {
    const path = this.styles.homeFile();
    const file = this.project.document(path);
    const added = newStyle(file?.text ?? '');
    if (file) file.change([{ from: file.text.length, to: file.text.length, insert: added.text.slice(file.text.length) }], 'new-style');
    else if ((await this.request({ kind: 'create', path, content: added.text })) !== null) return;
    this.jump({ path, from: added.from, to: added.to }, true);
  }

  /** Stores an edit of spreadsheet `path`: its bytes, and its Typst file next to it (`typstPath`). */
  private saveSpreadsheet(path: ProjectPath, { bytes, typst: content }: WorkbookEdit): void {
    void this.request({ kind: 'update', path, content: bytes });
    const target = typstPath(path);
    if (this.project.content(target) === content) return;
    void this.request(this.project.has(target) ? { kind: 'update', path: target, content } : { kind: 'create', path: target, content });
  }

  /**
   * Opens the file of `target` and reveals the range (in the source view on request). Its path comes from the
   * engine (a click in the preview, a diagnostic): a package file is no project path, and is ignored.
   */
  private jump(target: { path: string; from: number; to: number }, inSource = false): void {
    const path = ProjectPath.parse(target.path);
    if (!path || !this.project.document(path)) return;
    if (path !== this.active) this.open(path);
    this.views.reveal(target.from, target.to, inSource);
  }

  /** "← previous file" / "next file →" around an included file, in the main file's reading order. */
  private showNeighbours(): void {
    this.navigation.show(neighbours((path) => this.project.document(path)?.text, this.project.main, this.active));
  }

  private showDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    for (const document of this.documents()) {
      const path = this.project.pathOf(document);
      const own = diagnostics.filter((d) => d.path === path);
      this.views.setDiagnostics(document, own);
      this.sourceDiagnostics.set(document, own);
    }
    this.showStatus();
  }

  private showStatus(): void {
    if (this.diagnostics) this.status.show(summarizeDiagnostics(this.diagnostics, this.lastSource));
  }

  private renderFiles(): void {
    const paths = this.project.paths();
    const mode = this.options.fileList ?? 'auto';
    this.layout.setAvailable('files', mode !== 'hide');
    this.layout.setDefault('files', mode === 'show' || paths.length > 1);
    this.files.acceptDrops = mode !== 'hide';
    this.files.render({ paths, main: this.project.main, active: this.active });
  }

  private documents() {
    return this.project.paths().flatMap((path) => this.project.document(path) ?? []);
  }
}

const STYLE_ID = 'typst-editor-styles';

function injectStyles(host: HTMLElement): void {
  const root = host.getRootNode();
  const target = root instanceof ShadowRoot ? root : host.ownerDocument.head;
  if (target.querySelector(`#${STYLE_ID}`)) return;
  const style = host.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = proseMirrorStyles + styles + layoutStyles + fileStyles;
  target.append(style);
}

const FOLLOW_KEY = 'typst-editor:follow-cursor';

/** The viewer's last "Follow cursor" choice, if storage has one (storage may be unavailable). */
function rememberedFollow(): boolean | null {
  try {
    const stored = localStorage.getItem(FOLLOW_KEY);
    return stored === null ? null : stored === 'true';
  } catch {
    return null;
  }
}

function rememberFollow(on: boolean): void {
  try {
    localStorage.setItem(FOLLOW_KEY, String(on));
  } catch {
    // private window, blocked storage: the choice lasts for this page only
  }
}
