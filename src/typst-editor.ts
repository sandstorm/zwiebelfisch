// createTypstEditor: the widget. Composes a Project, the editing views (typst-editor/editing-views.ts), the
// preview, the file panel (in typst-editor/layout.ts), the status bar and the features. See ARCHITECTURE.md, "createTypstEditor".
import type { CollaborationOptions } from './features/collaboration/collaboration';
import type { Diagnostic } from './core/typst-engine/typst-engine';
import type { TypstDocument } from './core/typst-document/typst-document';
import { Preview } from './features/preview/preview';
import proseMirrorStyles from './features/visual-view/visual-view.css?inline';
import { AssetView, FilePanel, filesPanelIcon } from './features/files/files';
import fileStyles from './features/files/files.css?inline';
import { ChangeTracking } from './features/changes/changes';
import { CommentAction } from './features/comments/comments';
import { CollaborationLink } from './typst-editor/collaboration-link';
import changeStyles from './features/changes/changes.css?inline';
import { DiagnosticsStatus, summarizeDiagnostics } from './features/diagnostics/diagnostics';
import { EditingViews, type EditorMode } from './typst-editor/editing-views';
import { Layout } from './typst-editor/layout';
import layoutStyles from './typst-editor/layout.css?inline';
import { type FileChange, type FileLinks, neighbours, Project, type ProjectFiles, resolvePath } from './core/project/project';
import { FileNavigation } from './typst-editor/file-navigation';
import { PdfExport } from './typst-editor/pdf-export';
import { ProjectRenderings } from './typst-editor/project-renderings';
import { LabelIndex } from './features/labels/labels';
import { newStyle, StyleIndex } from './features/styles/styles';
import styles from './typst-editor.css?inline';
import { VersionControls, type Versions } from './features/versions/versions';

export type { CollaborationOptions } from './features/collaboration/collaboration';
export type { EditorMode } from './typst-editor/editing-views';
export type { FileChange, ProjectFiles } from './core/project/project';

/**
 * The file panel: `auto` (default) open while the project has more than one file, collapsed to its rail
 * button otherwise (until someone opens or closes it); `show` open; `hide` none at all.
 */
export type FileListMode = 'auto' | 'show' | 'hide';

export interface TypstEditorOptions {
  /** Typst source of the main file (default: `files[main]`, else empty). */
  source?: string;
  /** Path of the main file (default `/main.typ`). It is compiled, and cannot be renamed or deleted. */
  main?: string;
  /**
   * The project's files by absolute path: further `.typ` files (editable,
   * each in its own views), images and data files (shown read-only).
   * `@preview` packages need no entry: they are downloaded on first import.
   */
  files?: ProjectFiles;
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** When the file panel is open (default `auto`: when there is more than one file; see FileListMode). */
  fileList?: FileListMode;
  /**
   * Decides whether a create / rename / delete / upload someone asked for in
   * the file panel may happen (default: all may). May be async, e.g. to ask a server.
   */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /** Called after every change to any file: edits (`update`) and create / rename / delete. */
  onFilesChange?(change: FileChange): void;
  /** Called whenever the main file's text changes. */
  onChange?(source: string): void;
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
   * images come from the repository, a "Save version" button commits, and
   * "Changes since …" compares with the last commit.
   */
  collaboration?: CollaborationOptions;
  /**
   * An earlier version of the main file (last saved, last commit) to show the
   * changes against: inline diff in the Source view, track changes in the
   * Visual view, change bars in the preview. Without it every Typst file is
   * compared with its text as opened (a file created since is all new). See
   * also `setBase`.
   */
  base?: string;
  /** How the toggle names `base`: "Changes since <baseLabel>" (default "the given version"). */
  baseLabel?: string;
  /**
   * Whether the preview toolbar has "Download PDF" (default true): without
   * comments, or with them from its menu. Hosts can call `exportPdf` either way.
   */
  pdfDownload?: boolean;
}

/** Which PDF `exportPdf` makes. */
export interface PdfExportOptions {
  /** With the margin notes as the preview shows them (default false: the final version, notes left out). */
  comments?: boolean;
}

export interface TypstEditor {
  /**
   * The current Typst source of the main file. Assigning replaces it as one
   * minimal edit (only the differing middle changes) and also triggers `onChange`.
   */
  source: string;
  /** All files but the main one, with current text; assigning replaces them all and recompiles. */
  files: ProjectFiles;
  /** The path of the file shown in the editing area. */
  readonly activeFile: string;
  /** Shows `path` in the editing area (if the project has it). */
  open(path: string): void;
  /**
   * Shows the changes of the main file (or of `path`) against `base` (an
   * earlier text) from now on; the one "Changes since <label>" toggle names it
   * (default "the given version"). Other files keep their bases. null goes
   * back to comparing every file with its text as opened.
   */
  setBase(base: string | null, label?: string, path?: string): void;
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
    get source() {
      return main.text;
    },
    set source(text: string) {
      main.setText(text, 'api');
    },
    get files() {
      return widget.project.otherFiles();
    },
    set files(next: ProjectFiles) {
      widget.replaceFiles(next);
    },
    get activeFile() {
      return widget.active;
    },
    open: (path) => widget.open(path),
    setBase: (base, label, path) => widget.changes.setBase(base === null ? null : { text: base, label: label ?? GIVEN_VERSION }, path),
    exportPdf: (options = {}) => widget.pdfs.blob(options.comments ?? false),
    destroy: () => widget.destroy(),
  };
}

/** The composition: which file is shown where, and who hears about what. */
class Widget {
  readonly project: Project;
  /** The file shown in the editing area. */
  active: string;
  /** The Typst file shown last: where images are inserted and whose diagnostics the status counts. */
  private lastSource: string;
  private diagnostics: Diagnostic[] | null = null;
  private readonly layout: Layout;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly status: DiagnosticsStatus;
  private readonly preview: Preview;
  readonly pdfs: PdfExport;
  private readonly views: EditingViews;
  private readonly navigation: FileNavigation;
  private readonly files: FilePanel;
  private readonly assets: AssetView;
  private readonly renderings: ProjectRenderings;
  private readonly labels: LabelIndex;
  private readonly styles: StyleIndex;
  private readonly commentAction: CommentAction;
  readonly changes: ChangeTracking;
  private readonly collaboration: CollaborationLink | null = null;
  private versions: VersionControls | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly options: TypstEditorOptions,
  ) {
    injectStyles(host);
    const main = options.main ?? '/main.typ';
    const files = { ...options.files, ...(options.source === undefined ? {} : { [main]: options.source }) };
    this.project = new Project(main, files);
    this.active = this.lastSource = main;
    host.classList.add('typst-editor');
    this.layout = new Layout(host, `typst-editor:${main}`);
    this.left = this.layout.editor;
    this.right = this.layout.preview;

    this.status = new DiagnosticsStatus(host, (target) => this.jump(target, true));
    this.preview = new Preview(this.right, {
      onJump: (jump) => this.jump(jump),
      onDiagnostics: (diagnostics) => this.showDiagnostics(diagnostics),
      follow: options.followCursor ?? rememberedFollow() ?? true,
      onFollowChange: rememberFollow,
      pdf: options.pdfDownload === false ? undefined : (comments) => this.pdfs.file(comments),
    });
    this.pdfs = new PdfExport(this.project, this.preview);
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
    });
    this.assets = new AssetView(this.left);
    this.unsubscribe = this.project.onChange((change) => this.changed(change));
    // the Visual view has "Comment" in its toolbar; the tab bar's button is for the Source view
    this.commentAction = new CommentAction(host, () => this.views.shown());
    this.views.addTabAction(this.commentAction.button, 'source');
    this.changes = this.mountChanges(); // before any views exist: they attach to it when created
    this.open(main);
    if (options.collaboration) {
      this.collaboration = this.mountCollaboration(options.collaboration);
      this.showCursors();
    }
    this.refresh();
  }

  open(path: string): void {
    if (!this.project.has(path)) return;
    const changed = path !== this.active;
    this.active = path;
    const document = this.project.document(path);
    if (document) {
      this.lastSource = path;
      this.assets.hide();
    } else {
      this.assets.show(path, this.project.content(path)!);
    }
    this.views.show(document ?? null);
    this.showNeighbours();
    this.showCursors();
    this.renderFiles();
    this.showStatus();
    if (changed) this.options.onOpen?.(path);
  }

  /** The Visual/Source views of every document, wired to the preview, collaboration, changes and file links. */
  private mountViews(): EditingViews {
    return new EditingViews(this.left, {
      mode: this.options.mode,
      visualOptions: (document) => ({
        ...this.renderings.forDocument(document),
        user: this.options.user,
        comment: () => this.commentAction.comment(),
        labels: this.labels,
        styles: { ...this.styles.forDocument(document), create: () => void this.newStyle() },
      }),
      links: (document) => this.fileLinks(document),
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) void this.preview.reveal(path, offset);
      },
      // Publish the local selection from the editors' own updates: the DOM's selectionchange
      // fires before CodeMirror/ProseMirror read the new selection, so it would publish the previous one.
      onSelection: () => this.collaboration?.selectionChanged(),
      // accepting a change moves that file's base; it is still the same version for the reader
      onBaseChange: (document, base) => this.changes.accept(document, base),
      onCreate: (document, views) => this.changes.attach(document, [views.source, views.visual]),
    });
  }

  /** "Changes since …" for every Typst file: the main file against `options.base`, else each file as opened. */
  private mountChanges(): ChangeTracking {
    const actions = this.host.ownerDocument.createElement('span');
    actions.className = 'typst-editor__tab-actions';
    this.views.addTabAction(actions);
    return new ChangeTracking(
      actions,
      { project: this.project, preview: (path, ranges) => this.preview.showChanges(path, ranges) },
      this.options.base === undefined ? null : { text: this.options.base, label: this.options.baseLabel ?? GIVEN_VERSION },
    );
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
      onSynced: () => this.changes.resetOpened(),
      onVersions: (versions) => this.mountVersions(versions),
      // Where the others are, in every file: dots in the file panel.
      onPresence: (presences) => this.files.showPresence(presences),
    });
  }

  /** "Save version" next to the tabs, in a room backed by a GitLab branch; "Changes since …" follows its last commit. */
  private mountVersions(versions: Versions): void {
    const toolbar = this.host.ownerDocument.createElement('span');
    toolbar.className = 'typst-editor__tab-actions';
    this.views.addTabAction(toolbar);
    this.versions = new VersionControls(toolbar, versions, { user: this.options.user, setBase: (base) => this.changes.setBases('last saved version', base) });
  }

  private showCursors(): void {
    const document = this.project.document(this.active);
    const views = document ? this.views.viewsOf(document) : null;
    this.collaboration?.show(views ? this.active : null, views ? [views.visual, views.source] : []);
  }

  replaceFiles(files: ProjectFiles): void {
    this.project.replace(files);
    this.collaboration?.sync();
    this.views.retain(this.documents());
    this.open(this.project.has(this.active) ? this.active : this.project.main);
    if (!this.project.has(this.lastSource)) this.lastSource = this.project.main;
    this.changes.refresh();
    this.labels.refresh();
    this.styles.refresh();
    this.refresh();
  }

  destroy(): void {
    this.unsubscribe();
    this.versions?.destroy();
    this.collaboration?.destroy();
    this.changes.destroy();
    this.commentAction.destroy();
    this.views.destroy();
    this.files.destroy();
    this.assets.destroy();
    this.renderings.destroy();
    this.labels.destroy();
    this.styles.destroy();
    this.preview.destroy();
    this.status.destroy();
    this.project.destroy();
    this.host.classList.remove('typst-editor');
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
    if (change.kind === 'update' && change.path === this.project.main) this.options.onChange?.(change.content);
  }

  /** Keeps `active` and `lastSource` pointing at existing files after a create / rename / delete. */
  private restructured(change: FileChange): void {
    const follow = (path: string) => {
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

  /** Where the paths written in `document` lead: resolved from its current path, opened here. */
  private fileLinks(document: TypstDocument): FileLinks {
    return {
      resolve: (reference) => {
        const file = this.project.pathOf(document);
        return file ? resolvePath(file, reference) : null;
      },
      exists: (path) => this.project.has(path),
      open: (path) => this.open(path),
      create: async (path) => {
        const problem = await this.request({ kind: 'create', path, content: '' });
        if (problem === null) this.open(path);
        return problem;
      },
    };
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

  /** Opens the file of `target` and reveals the range (in the source view on request). */
  private jump(target: { path: string; from: number; to: number }, inSource = false): void {
    if (!this.project.document(target.path)) return;
    if (target.path !== this.active) this.open(target.path);
    this.views.reveal(target.from, target.to, inSource);
  }

  /** "← previous file" / "next file →" around an included file, in the main file's reading order. */
  private showNeighbours(): void {
    this.navigation.show(neighbours(this.project.files(), this.project.main, this.active));
  }

  private showDiagnostics(diagnostics: Diagnostic[]): void {
    this.diagnostics = diagnostics;
    for (const document of this.documents()) {
      const path = this.project.pathOf(document);
      this.views.setDiagnostics(document, diagnostics.filter((d) => d.path === path));
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
  style.textContent = proseMirrorStyles + styles + layoutStyles + fileStyles + changeStyles;
  target.append(style);
}

/** How "Changes since …" names a base the host gave without a label. */
const GIVEN_VERSION = 'the given version';

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
