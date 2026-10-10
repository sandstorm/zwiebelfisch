// WorkbenchHost: the widget's frame around a Project — layout, editing views, file views, preview — and the
// extensions put into it. What createTypstEditor creates; extensions see it as `Workbench`. See workbench.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { DocumentLinkProvider } from '../../core/document-links/document-links';
import { ProjectPath, type FileKind } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import { type PdfSource, Preview } from '../../features/preview/preview';
import type { VisualViewOptions } from '../../features/visual-view/visual-view';
import { ColorScheme } from './color-scheme/color-scheme';
import { Commands } from './commands/commands';
import { EditingViews, type EditorMode } from './editing-views/editing-views';
import { ExtensionHost } from './extension-host/extension-host';
import { FileDrops } from './file-drops/file-drops';
import { FileViews } from './file-views/file-views';
import { Layout, type Memory } from './layout/layout';
import type {
  ActiveEditor,
  CommandArguments,
  CommandRegistry,
  CommandResult,
  FileViewProvider,
  OpenOptions,
  PreviewContributions,
  SidePanel,
  SidePanelOptions,
  TypstExtension,
  VisualViewContributions,
  Workbench,
} from './workbench';

export interface WorkbenchOptions {
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** Light or dark colors, or as the OS; default: as the page (see ARCHITECTURE.md, "Dark mode"). */
  theme?: 'light' | 'dark' | 'auto';
  /** Whether the preview starts following the cursor; default: what this viewer chose last, else on. */
  followCursor?: boolean;
  /** The host's veto on a change someone asked for (`applyChange`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /** Another file is shown in the editing area. */
  onOpen?(path: ProjectPath): void;
}

/**
 * The frame of the widget on `host`: shows the project's files (Typst files in the Visual / Source tabs, others in
 * the file views extensions register), keeps the preview compiling the main file and in step with the cursor,
 * and runs the extensions. `activate` starts it: extensions first (their contributions are in place before any
 * view exists), then the preview and the main file.
 */
export class WorkbenchHost implements Workbench {
  #active: ProjectPath;
  #diagnostics: readonly Diagnostic[] | null = null;
  readonly #layout: Layout;
  readonly #views: EditingViews;
  readonly #fileViews: FileViews;
  readonly #commands: Commands;
  readonly #drops: FileDrops;
  readonly #scheme: ColorScheme;
  readonly #extensions: ExtensionHost;
  #preview: Preview | null = null;
  #pdfSource: PdfSource | null = null;
  #hasFrame = false;
  readonly #visualOptions: ((document: TypstDocument) => VisualViewOptions)[] = [];
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #diagnosticsChanged = new EventEmitter<readonly Diagnostic[]>();
  readonly #selectionChanged = new EventEmitter<TypstDocument>();
  readonly #unsubscribe: () => void;

  readonly onDidShowFile = this.#shown.event;
  readonly onDidChangeDiagnostics = this.#diagnosticsChanged.event;
  readonly onDidChangeEditorSelection = this.#selectionChanged.event;
  readonly onDidDropFiles: Event<File[]>;

  constructor(
    private readonly host: HTMLElement,
    private readonly project: Project,
    private readonly options: WorkbenchOptions = {},
  ) {
    this.#active = project.main;
    host.classList.add('typst-editor');
    if (options.theme) host.dataset.theme = options.theme;
    this.#scheme = new ColorScheme(host);
    this.#layout = new Layout(host, `typst-editor:${project.main}`);
    this.#commands = new Commands(host);
    this.#drops = new FileDrops(host);
    this.onDidDropFiles = this.#drops.onDidDrop;
    this.#views = this.#createViews();
    this.#fileViews = new FileViews(this.#layout.editor);
    this.#unsubscribe = project.onChange((change) => this.#changed(change));
    this.#extensions = new ExtensionHost({
      project,
      workbench: this,
      visualView: this.#visualViewContributions(),
      sourceView: {},
      preview: this.#previewContributions(),
    });
  }

  /** Activates `extensions` (in order), then shows the main file and compiles it. Once. */
  activate(extensions: readonly TypstExtension[]): void {
    this.#extensions.activate(extensions);
    const source = this.#pdfSource;
    this.#preview = new Preview(this.#layout.preview, {
      onJump: (jump) => this.#jump(jump),
      onDiagnostics: (diagnostics) => this.#showDiagnostics(diagnostics),
      follow: this.options.followCursor ?? rememberedFollow() ?? true,
      onFollowChange: rememberFollow,
      pdf: source ?? undefined,
    });
    this.open(this.project.main);
    this.#compile();
  }

  get ownerDocument(): Document {
    return this.host.ownerDocument;
  }

  get activeFile(): ProjectPath {
    return this.#active;
  }

  open(path: ProjectPath, options: OpenOptions = {}): void {
    if (!this.project.has(path)) return;
    const changed = path !== this.#active;
    this.#active = path;
    const document = this.project.document(path);
    this.#fileViews.show(document ? null : { path, content: this.project.content(path)! });
    this.#views.show(document ?? null);
    if (document && options.selection) this.#views.reveal(options.selection.from, options.selection.to, options.mode);
    this.#shown.fire(path);
    if (changed) this.options.onOpen?.(path);
  }

  async applyChange(change: FileChange): Promise<string | null> {
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

  registerSidePanel(id: string, options: SidePanelOptions): SidePanel {
    const layout = this.#layout;
    const body = layout.addPanel(id, options);
    return {
      body,
      setDefault: (open) => layout.setDefault(id, open),
      setAvailable: (available) => layout.setAvailable(id, available),
      dismiss: () => layout.dismiss(),
      dispose: () => layout.removePanel(id),
    };
  }

  registerStatusBarItem(element: HTMLElement): Disposable {
    this.#layout.statusBar.append(element);
    return new Disposable(() => element.remove());
  }

  registerTabBarItem(element: HTMLElement, options: { mode?: EditorMode } = {}): Disposable {
    return new Disposable(this.#views.addTabAction(element, options.mode));
  }

  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable {
    if (this.#hasFrame) throw new Error('There is an editor frame already');
    this.#hasFrame = true;
    this.#views.setFrame(frame);
    return new Disposable(() => {
      this.#hasFrame = false;
      this.#views.setFrame(null);
    });
  }

  registerFileView(kind: Exclude<FileKind, 'typst'>, provider: FileViewProvider): Disposable {
    return this.#fileViews.register(kind, provider);
  }

  registerCommand<K extends keyof CommandRegistry>(id: K, handler: CommandRegistry[K]): Disposable {
    return this.#commands.register(id, handler);
  }

  executeCommand<K extends keyof CommandRegistry>(id: K, ...args: CommandArguments<K>): CommandResult<K> {
    return this.#commands.execute(id, ...args);
  }

  registerKeybinding(key: string, command: keyof CommandRegistry): Disposable {
    return this.#commands.bind(key, command);
  }

  remember<T>(name: string): Memory<T> {
    return this.#layout.remember<T>(name);
  }

  get diagnostics(): readonly Diagnostic[] | null {
    return this.#diagnostics;
  }

  get activeEditor(): ActiveEditor | null {
    const shown = this.#views.shown();
    if (!shown) return null;
    const { visual, source } = this.#views.viewsOf(shown.document);
    return { path: this.#active, document: shown.document, view: shown.view, views: [visual, source] };
  }

  isEditorFocused(): boolean {
    const area = this.#layout.editor;
    const root = area.getRootNode() as Document | ShadowRoot;
    return root.activeElement !== null && area.contains(root.activeElement);
  }

  destroy(): void {
    this.#unsubscribe();
    this.#extensions.dispose();
    this.#views.destroy();
    this.#fileViews.dispose();
    this.#preview?.destroy();
    this.#commands.dispose();
    this.#drops.dispose();
    for (const emitter of [this.#shown, this.#diagnosticsChanged, this.#selectionChanged]) emitter.dispose();
    this.host.classList.remove('typst-editor');
    delete this.host.dataset.theme;
    this.#scheme.destroy();
    this.#layout.destroy();
  }

  /** The Visual/Source views of every document, wired to the preview and file links, with the extensions' options. */
  #createViews(): EditingViews {
    return new EditingViews(this.#layout.editor, {
      mode: this.options.mode,
      visualOptions: (document) => Object.assign({}, ...this.#visualOptions.map((options) => options(document))),
      documentLinks: (document) => this.#documentLinks(document),
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) this.#preview?.reveal(path, offset);
      },
      // Fired from the editors' own updates: the DOM's selectionchange fires before
      // CodeMirror/ProseMirror read the new selection, so a listener would see the previous one.
      onSelection: (document) => this.#selectionChanged.fire(document),
    });
  }

  #visualViewContributions(): VisualViewContributions {
    return {
      registerDocumentOptions: (provider) => {
        this.#visualOptions.push(provider);
        return new Disposable(() => this.#visualOptions.splice(this.#visualOptions.indexOf(provider), 1));
      },
    };
  }

  #previewContributions(): PreviewContributions {
    const preview = () => {
      if (!this.#preview) throw new Error('The preview starts after the extensions have activated');
      return this.#preview;
    };
    return {
      registerPdfSource: (source) => {
        if (this.#pdfSource) throw new Error('A PDF source is registered already');
        this.#pdfSource = source;
        return new Disposable(() => (this.#pdfSource = null));
      },
      engine: {
        snippet: (...args) => preview().snippet(...args),
        onRender: (listener) => preview().onRender(listener),
        exportPdf: (...args) => preview().exportPdf(...args),
      },
    };
  }

  #compile(): void {
    this.#preview?.update(this.project.files(), this.project.main);
  }

  #changed(change: FileChange): void {
    this.#compile();
    if (change.kind !== 'update') this.#restructured(change);
  }

  /** Keeps the editing area on an existing file after a create / rename / delete (a renamed file stays shown). */
  #restructured(change: FileChange): void {
    this.#views.retain(this.#documents());
    const active = this.#active;
    if (change.kind === 'rename' && change.from === active) this.open(change.path);
    else this.open(this.project.has(active) ? active : this.project.main);
  }

  /** The links of `document`: its paths resolve from its current path and open here. */
  #documentLinks(document: TypstDocument): DocumentLinkProvider {
    return new DocumentLinkProvider({
      resolve: (reference) => {
        const file = this.project.pathOf(document);
        return file ? ProjectPath.resolve(file, reference) : null;
      },
      exists: (path) => this.project.has(path),
      open: (path) => this.open(path),
      create: async (path) => {
        const problem = await this.applyChange({ kind: 'create', path, content: '' });
        if (problem === null) this.open(path);
        return problem;
      },
    });
  }

  /** A click in the preview: opens its file and reveals the range. A package file is no project file, and ignored. */
  #jump(target: { path: string; from: number; to: number }): void {
    const path = ProjectPath.parse(target.path);
    if (!path || !this.project.document(path)) return;
    this.open(path, { selection: target });
  }

  /** Marks each document's diagnostics in its views and tells the listeners. */
  #showDiagnostics(diagnostics: Diagnostic[]): void {
    this.#diagnostics = diagnostics;
    for (const document of this.#documents()) {
      const path = this.project.pathOf(document);
      this.#views.setDiagnostics(document, diagnostics.filter((d) => d.path === path));
    }
    this.#diagnosticsChanged.fire(diagnostics);
  }

  #documents(): TypstDocument[] {
    return this.project.paths().flatMap((path) => this.project.document(path) ?? []);
  }
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
