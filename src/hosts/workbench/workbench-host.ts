// WorkbenchHost: the widget's frame around a Project — layout, editing views, file views, preview — and the
// extensions put into it. What createTypstEditor creates; extensions see it as `Workbench`. See workbench.ts.
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import { ProjectPath, type FileKind } from '../../core/paths/paths';
import type { FileChange, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { Preview } from '../preview/preview';
import { SourceViewHost } from '../source-view/source-view';
import { VisualViewContributions } from '../visual-view/visual-view';
import { ColorScheme } from './color-scheme/color-scheme';
import { Commands } from './commands/commands';
import { EditingViews, type EditorMode } from './editing-views/editing-views';
import { ExtensionHost } from './extension-host/extension-host';
import { FileDrops } from './file-drops/file-drops';
import { FileViews } from './file-views/file-views';
import { Layout, type Memory } from './layout/layout';
import type {
  CommandArguments,
  CommandRegistry,
  CommandResult,
  FileViewProvider,
  OpenOptions,
  SidePanel,
  SidePanelOptions,
  TextEditor,
  TextEditorSelectionChangeEvent,
  TypstExtension,
  Workbench,
} from './workbench';

export interface WorkbenchOptions {
  /** The editing view shown first (default: visual). */
  mode?: EditorMode;
  /** Light or dark colors, or as the OS; default: as the page (see ARCHITECTURE.md, "Dark mode"). */
  theme?: 'light' | 'dark' | 'auto';
  /** The host's veto on a change someone asked for (`applyChange`); default: all may happen. */
  allowFileChange?(change: FileChange): boolean | Promise<boolean>;
  /** Another file is shown in the editing area. */
  onOpen?(path: ProjectPath): void;
}

/**
 * The frame of the widget on `host`: shows the project's files (Typst files in the Visual / Source tabs, others in
 * the file views extensions register), keeps the preview compiling the main file and in step with the cursor,
 * and runs the extensions. The Visual and Source views and the preview are its hosts (`ExtensionContext.visualView`,
 * `sourceView`, `preview`). `activate` starts it: extensions first (their contributions are in place before any view exists),
 * then the main file is shown and compiled.
 */
export class WorkbenchHost implements Workbench {
  #active: ProjectPath;
  readonly #layout: Layout;
  readonly #views: EditingViews;
  readonly #fileViews: FileViews;
  readonly #commands: Commands;
  readonly #drops: FileDrops;
  readonly #scheme: ColorScheme;
  readonly #extensions: ExtensionHost;
  readonly #visualView = new VisualViewContributions();
  readonly #sourceViews = new SourceViewHost();
  readonly #preview: Preview;
  #hasFrame = false;
  readonly #shown = new EventEmitter<ProjectPath>();
  readonly #selectionChanged = new EventEmitter<TextEditorSelectionChangeEvent>();
  readonly #unsubscribe: () => void;

  readonly onDidShowFile = this.#shown.event;
  readonly onDidChangeTextEditorSelection = this.#selectionChanged.event;
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
    this.#preview = new Preview(this.#layout.preview, { onJump: (jump) => this.#jump(jump) });
    this.#unsubscribe = project.onChange((change) => this.#changed(change));
    this.#extensions = new ExtensionHost({
      project,
      workbench: this,
      visualView: this.#visualView,
      sourceView: this.#sourceViews,
      preview: this.#preview,
    });
  }

  /** Activates `extensions` (in order), then shows the main file and compiles it. Once. */
  activate(extensions: readonly TypstExtension[]): void {
    this.#extensions.activate(extensions);
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

  get activeTextEditor(): TextEditor | null {
    return this.#views.activeEditor();
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
    this.#preview.destroy();
    this.#commands.dispose();
    this.#drops.dispose();
    for (const emitter of [this.#shown, this.#selectionChanged]) emitter.dispose();
    this.host.classList.remove('typst-editor');
    delete this.host.dataset.theme;
    this.#scheme.destroy();
    this.#layout.destroy();
  }

  /** The Visual/Source views of every document, wired to the preview, with the extensions' contributions. */
  #createViews(): EditingViews {
    return new EditingViews(this.#layout.editor, {
      mode: this.options.mode,
      visualView: this.#visualView,
      sourceViews: this.#sourceViews,
      onCursor: (document, offset) => {
        const path = this.project.pathOf(document);
        if (path) this.#preview.reveal(path, offset);
      },
      // Fired from the editors' own updates: the DOM's selectionchange fires before
      // CodeMirror/ProseMirror read the new selection, so a listener would see the previous one.
      onSelection: (textEditor) => this.#selectionChanged.fire({ textEditor }),
    });
  }

  #compile(): void {
    this.#preview.update(this.project.files(), this.project.main);
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

  /** A click in the preview: opens its file and reveals the range. A package file is no project file, and ignored. */
  #jump(target: { path: string; from: number; to: number }): void {
    const path = ProjectPath.parse(target.path);
    if (!path || !this.project.document(path)) return;
    this.open(path, { selection: target });
  }

  #documents(): TypstDocument[] {
    return this.project.paths().flatMap((path) => this.project.document(path) ?? []);
  }
}
