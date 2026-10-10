import type { CollaborationOptions } from '../collab/collaboration';
import type { Diagnostic } from '../engine/engine';
import { Preview } from '../preview/preview';
import proseMirrorStyles from '../visual-view/prosemirror.css?inline';
import { AssetView } from './asset-view';
import { ChangeTracking } from './change-tracking';
import { CommentAction } from './comment-action';
import { CollaborationLink } from './collaboration-link';
import changeStyles from './changes.css?inline';
import { DiagnosticsStatus } from './diagnostics-status';
import { summarizeDiagnostics } from './diagnostics-summary';
import { EditingViews, type EditorMode } from './editing-views';
import { FileSwitcher } from './file-switcher';
import { insertImage } from './insert-image';
import { referencePath } from './paths';
import { Project, type FileChange, type ProjectFiles } from './project';
import { ProjectRenderings } from './project-renderings';
import styles from './styles.css?inline';
import { VersionControls, type Versions } from './version-controls';

export type { CollaborationOptions } from '../collab/collaboration';
export type { EditorMode } from './editing-views';
export type { FileChange, ProjectFiles } from './project';

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
  /** Who works here: the name (and cursor color) others see when collaborating, and who saves versions. */
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
   * "Show changes" compares with the last commit.
   */
  collaboration?: CollaborationOptions;
  /**
   * An earlier version of the main file (last saved, last commit) to show the
   * changes against: inline diff in the Source view, track changes in the
   * Visual view, change bars in the preview. See also `setBase`.
   */
  base?: string;
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
   * from now on, or none for null. A "Show changes" button toggles them while a base is set.
   */
  setBase(base: string | null): void;
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
    setBase: (base) => widget.changes.setBase(base),
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
    });
    this.renderings = new ProjectRenderings({ project: this.project, preview: this.preview, request: (change) => this.request(change) });
    this.views = new EditingViews(this.left, {
      mode: options.mode,
      visualOptions: (document) => this.renderings.forDocument(document),
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) void this.preview.reveal(path, offset);
      },
      onBaseChange: (document, base) => {
        if (this.project.pathOf(document) === this.project.main) this.changes.setBase(base);
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
    this.commentAction = new CommentAction(host, () => this.views.shown());
    this.views.addTabAction(this.commentAction.button);
    this.changes = this.mountChanges();
    if (options.collaboration) {
      this.collaboration = this.mountCollaboration(options.collaboration);
      this.showCursors();
    }
    this.refresh();
  }

  open(path: string): void {
    if (!this.project.has(path)) return;
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
  }

  /** "Show changes" for the main file: against `options.base`, in both of its views and the preview. */
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
      this.options.base,
    );
  }

  /** Shares the project; the others' carets show in the shown file's views, the preview and the file bar. */
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
      // Where the others are, in every file: markers in the preview, dots in the file bar.
      onPresence: (presences) => {
        this.preview.showPresence(presences);
        this.switcher.showPresence(presences);
      },
    });
  }

  /** "Save version" next to the tabs, in a room backed by a GitLab branch; "Show changes" follows its last commit. */
  private mountVersions(versions: Versions): void {
    const toolbar = this.host.ownerDocument.createElement('span');
    toolbar.className = 'typst-editor__tab-actions';
    this.views.addTabAction(toolbar);
    const main = this.project.main;
    this.versions = new VersionControls(toolbar, versions, { path: main, user: this.options.user, setBase: (base) => this.changes.setBase(base) });
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
