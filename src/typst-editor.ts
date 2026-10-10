// createTypstEditor: the widget. Composes a Project, the editing views (typst-editor/editing-views.ts), the
// preview, the file bar, the status bar and the features. See ARCHITECTURE.md, "createTypstEditor".
import type { CollaborationOptions } from './features/collaboration/collaboration';
import type { Diagnostic } from './core/typst-engine/typst-engine';
import { Preview } from './features/preview/preview';
import proseMirrorStyles from './features/visual-view/visual-view.css?inline';
import { AssetView, FileSwitcher, insertImage } from './features/files/files';
import { ChangeTracking } from './features/changes/changes';
import { CommentAction } from './features/comments/comments';
import { CollaborationLink } from './typst-editor/collaboration-link';
import changeStyles from './features/changes/changes.css?inline';
import { DiagnosticsStatus, summarizeDiagnostics } from './features/diagnostics/diagnostics';
import { EditingViews, type EditorMode } from './typst-editor/editing-views';
import { type FileChange, Project, type ProjectFiles, referencePath } from './core/project/project';
import { PdfExport } from './typst-editor/pdf-export';
import { ProjectRenderings } from './typst-editor/project-renderings';
import styles from './typst-editor.css?inline';
import { VersionControls, type Versions } from './features/versions/versions';

export type { CollaborationOptions } from './features/collaboration/collaboration';
export type { EditorMode } from './typst-editor/editing-views';
export type { FileChange, ProjectFiles } from './core/project/project';

/** When the file bar is shown: `auto` (default) as soon as the project has more than one file. */
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
  /** When to show the file bar (default `auto`: when there is more than one file). */
  fileList?: FileListMode;
  /**
   * Decides whether a create / rename / delete / upload someone asked for in
   * the file bar may happen (default: all may). May be async, e.g. to ask a server.
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
   * Visual view, change bars in the preview. See also `setBase`.
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
   * Shows the changes of the main file against `base` (an earlier source)
   * from now on; the "Changes since <label>" toggle names it (default "the
   * given version"). null goes back to comparing with the text as opened.
   */
  setBase(base: string | null, label?: string): void;
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
 * the source and counted in a status bar that jumps to the first one. With
 * more than one file, a file bar above the editing view switches between them.
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
    setBase: (base, label) => widget.changes.setBase(base === null ? null : { text: base, label: label ?? GIVEN_VERSION }),
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
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly status: DiagnosticsStatus;
  private readonly preview: Preview;
  readonly pdfs: PdfExport;
  private readonly views: EditingViews;
  private readonly switcher: FileSwitcher;
  private readonly assets: AssetView;
  private readonly renderings: ProjectRenderings;
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
    this.left = el(host.ownerDocument, 'typst-editor__left');
    this.right = el(host.ownerDocument, 'typst-editor__right');
    host.classList.add('typst-editor');
    host.append(this.left, this.right);

    this.status = new DiagnosticsStatus(host, (target) => this.jump(target, true));
    this.preview = new Preview(this.right, {
      onJump: (jump) => this.jump(jump),
      onDiagnostics: (diagnostics) => this.showDiagnostics(diagnostics),
      follow: options.followCursor ?? rememberedFollow() ?? true,
      onFollowChange: rememberFollow,
      pdf: options.pdfDownload === false ? undefined : (comments) => this.pdfs.file(comments),
    });
    this.pdfs = new PdfExport(this.project, this.preview);
    this.renderings = new ProjectRenderings({ project: this.project, preview: this.preview, request: (change) => this.request(change) });
    this.views = new EditingViews(this.left, {
      mode: options.mode,
      visualOptions: (document) => ({
        ...this.renderings.forDocument(document),
        user: options.user,
        comment: () => this.commentAction.comment(),
      }),
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) void this.preview.reveal(path, offset);
      },
      // Publish the local selection from the editors' own updates: the DOM's selectionchange
      // fires before CodeMirror/ProseMirror read the new selection, so it would publish the previous one.
      onSelection: () => this.collaboration?.selectionChanged(),
      onBaseChange: (document, base) => {
        // accepting a change moves the base; it is still the same version for the reader
        if (this.project.pathOf(document) === this.project.main) this.changes.setBase({ text: base, label: this.changes.label });
      },
    });
    // Drops anywhere on the widget (also the preview): never the browser opening the file instead.
    this.switcher = new FileSwitcher(this.left, host, {
      onOpen: (path) => this.open(path),
      onChange: (change) => this.request(change),
    });
    this.assets = new AssetView(this.left, (path) => this.insertImage(path));
    this.unsubscribe = this.project.onChange((change) => this.changed(change));
    this.open(main);
    // the Visual view has "Comment" in its toolbar; the tab bar's button is for the Source view
    this.commentAction = new CommentAction(host, () => this.views.shown());
    this.views.addTabAction(this.commentAction.button, 'source');
    this.changes = this.mountChanges();
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
      this.assets.show(path, this.project.content(path)!, this.lastSource);
    }
    this.views.show(document ?? null);
    this.showCursors();
    this.renderFiles();
    this.showStatus();
    if (changed) this.options.onOpen?.(path);
  }

  /** "Changes since …" for the main file: against `options.base`, else the text as opened; both views and the preview. */
  private mountChanges(): ChangeTracking {
    const main = this.project.main;
    const document = this.project.document(main)!;
    const views = this.views.viewsOf(document);
    const actions = this.host.ownerDocument.createElement('span');
    actions.className = 'typst-editor__tab-actions';
    this.views.addTabAction(actions);
    return new ChangeTracking(
      actions,
      { document, views: [views.source, views.visual], preview: (ranges) => this.preview.showChanges(main, ranges) },
      this.options.base === undefined ? null : { text: this.options.base, label: this.options.baseLabel ?? GIVEN_VERSION },
    );
  }

  /** Shares the project; the others' carets show in the shown file's views and the file bar. */
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
      // Where the others are, in every file: dots in the file bar.
      onPresence: (presences) => this.switcher.showPresence(presences),
    });
  }

  /** "Save version" next to the tabs, in a room backed by a GitLab branch; "Changes since …" follows its last commit. */
  private mountVersions(versions: Versions): void {
    const toolbar = this.host.ownerDocument.createElement('span');
    toolbar.className = 'typst-editor__tab-actions';
    this.views.addTabAction(toolbar);
    const main = this.project.main;
    this.versions = new VersionControls(toolbar, versions, { path: main, user: this.options.user, setBase: (base) => this.changes.setBase(base === null ? null : { text: base, label: 'last saved version' }) });
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
    this.refresh();
  }

  destroy(): void {
    this.unsubscribe();
    this.versions?.destroy();
    this.collaboration?.destroy();
    this.changes.destroy();
    this.commentAction.destroy();
    this.views.destroy();
    this.switcher.destroy();
    this.assets.destroy();
    this.renderings.destroy();
    this.preview.destroy();
    this.status.destroy();
    this.project.destroy();
    this.host.classList.remove('typst-editor');
    this.left.remove();
    this.right.remove();
  }

  private refresh(): void {
    this.preview.update(this.project.files(), this.project.main);
  }

  private changed(change: FileChange): void {
    this.refresh();
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

  /** Applies a change asked for in the file bar, if the project and the host allow it. */
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

  /** Opens the file of `target` and reveals the range (in the source view on request). */
  private jump(target: { path: string; from: number; to: number }, inSource = false): void {
    if (!this.project.document(target.path)) return;
    if (target.path !== this.active) this.open(target.path);
    this.views.reveal(target.from, target.to, inSource);
  }

  private insertImage(path: string): void {
    const target = this.lastSource;
    const document = this.project.document(target)!;
    const offset = this.views.cursor(document) ?? document.text.length;
    const change = insertImage(document.text, offset, referencePath(target, path));
    document.change([change], 'insert-image');
    this.open(target);
    const start = change.from + change.insert.indexOf('#');
    this.views.reveal(start, change.from + change.insert.trimEnd().length);
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
    this.switcher.visible = mode === 'show' || (mode === 'auto' && paths.length > 1);
    this.switcher.render({ paths, main: this.project.main, active: this.active });
  }

  private documents() {
    return this.project.paths().flatMap((path) => this.project.document(path) ?? []);
  }
}

function el(doc: Document, className: string): HTMLElement {
  const element = doc.createElement('div');
  element.className = className;
  return element;
}

const STYLE_ID = 'typst-editor-styles';

function injectStyles(host: HTMLElement): void {
  const root = host.getRootNode();
  const target = root instanceof ShadowRoot ? root : host.ownerDocument.head;
  if (target.querySelector(`#${STYLE_ID}`)) return;
  const style = host.ownerDocument.createElement('style');
  style.id = STYLE_ID;
  style.textContent = proseMirrorStyles + styles + changeStyles;
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
