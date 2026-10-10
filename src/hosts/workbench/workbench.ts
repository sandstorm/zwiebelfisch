// The workbench host: the widget's frame (side panels, editing area with the Visual / Source tabs and file views,
// preview, status bar) and the extension API every feature uses to put itself into it. Entry of hosts/workbench/.
// Why extensions: the frame knows no feature by name. A feature is a `TypstExtension` that registers what it adds
// (a side panel, a file view, a command, a service other extensions read) once, at activation, and the host
// disposes all of it on destroy. Adding a feature is adding it to a list, not editing the frame.
// See ARCHITECTURE.md, "Extensions" and "Layout".
import type { Disposable } from '../../core/disposable/disposable';
import type { Event } from '../../core/event-emitter/event-emitter';
import type { FileKind, ProjectPath } from '../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import type { PdfSource, Preview } from '../../features/preview/preview';
import type { SourceView } from '../../features/source-view/source-view';
import type { VisualView, VisualViewOptions } from '../../features/visual-view/visual-view';
import type { EditorMode } from './editing-views/editing-views';
import type { Memory } from './layout/layout';

/** A feature of the widget: activated once, in list order; what it registers goes into `context.subscriptions`. */
export interface TypstExtension {
  /** Unique in the list (e.g. `files`). */
  readonly id: string;
  /** Registers the extension's contributions; everything it pushes into `context.subscriptions` is disposed on destroy. */
  activate(context: ExtensionContext): void;
}

/** What an extension gets to work with. Contributions are registered once, at activation; the hosts apply them to every view they create later. */
export interface ExtensionContext {
  /** Disposed when the widget is destroyed, in reverse order (the extensions in reverse list order, too). */
  readonly subscriptions: { dispose(): unknown }[];
  readonly project: Project;
  readonly workbench: Workbench;
  readonly visualView: VisualViewContributions;
  readonly sourceView: SourceViewContributions;
  readonly preview: PreviewContributions;
  /** What extensions provide each other (instead of importing each other). */
  readonly services: Services;
}

/**
 * The services extensions provide each other, by id. An extension adds its entry by declaration merging, next to
 * the code that provides it:
 *
 * ```ts
 * declare module '../../hosts/workbench/workbench' {
 *   interface ServiceRegistry { labels: LabelIndex }
 * }
 * ```
 */
export interface ServiceRegistry {}

export interface Services {
  /** Makes `service` available as `id` (once per id: a second provider is an error) until the result is disposed. */
  provide<K extends keyof ServiceRegistry>(id: K, service: ServiceRegistry[K]): Disposable;
  /** The service `id`, if an extension activated earlier in the list provides it. */
  get<K extends keyof ServiceRegistry>(id: K): ServiceRegistry[K] | undefined;
}

/** The commands extensions register, by id, with their handler's type; extended by declaration merging like `ServiceRegistry`. */
export interface CommandRegistry {}

export type CommandArguments<K extends keyof CommandRegistry> = CommandRegistry[K] extends (...args: infer A) => unknown ? A : never;
export type CommandResult<K extends keyof CommandRegistry> = CommandRegistry[K] extends (...args: never[]) => infer R ? R : never;

/** The widget's frame as extensions see it: which file is shown, and the places they can put things. */
export interface Workbench {
  /** The document the widget lives in, to create elements for it. */
  readonly ownerDocument: Document;
  /** The file shown in the editing area. */
  readonly activeFile: ProjectPath;
  /**
   * Shows `path` in the editing area (if the project has it): a Typst file in the Visual / Source tabs, any other
   * file in the view registered for its kind (nothing without one). Opening the shown file again shows it again (a
   * file view gets its current content). `selection` reveals a range of a Typst file, in the Source tab with `mode`.
   */
  open(path: ProjectPath, options?: OpenOptions): void;
  /** After a file was shown in the editing area (also when the same file is shown again). */
  readonly onDidShowFile: Event<ProjectPath>;
  /**
   * Applies `change` if the project allows it and then the host (`allowFileChange`, may be async; the project is
   * asked again afterwards). Resolves to the reason it was refused, or null once applied.
   */
  applyChange(change: FileChange): Promise<string | null>;

  /** Adds a side panel with its rail button (one panel is open at a time); disposing removes both. */
  registerSidePanel(id: string, options: SidePanelOptions): SidePanel;
  /** Puts `element` into the status bar below everything, after the items registered before. */
  registerStatusBarItem(element: HTMLElement): Disposable;
  /** Puts `element` at the end of the Visual / Source tab bar; with `mode`, it only shows in that tab. */
  registerTabBarItem(element: HTMLElement, options?: { mode?: EditorMode }): Disposable;
  /**
   * Shows `top` right before and `bottom` right after the shown Typst file's content (in the Visual tab below its
   * toolbar), scrolling with it, across tab and file switches; detached while no Typst file is shown. One frame at a time.
   */
  registerEditorFrame(frame: { top: HTMLElement; bottom: HTMLElement }): Disposable;
  /** Shows files of `kind` (not `typst`: that is the Visual / Source tabs) with the view `provider` creates. One provider per kind. */
  registerFileView(kind: Exclude<FileKind, 'typst'>, provider: FileViewProvider): Disposable;
  registerCommand<K extends keyof CommandRegistry>(id: K, handler: CommandRegistry[K]): Disposable;
  /** Runs command `id`; an error if none is registered. */
  executeCommand<K extends keyof CommandRegistry>(id: K, ...args: CommandArguments<K>): CommandResult<K>;
  /**
   * Runs `command` (without arguments) on `key` anywhere in the widget, before the editors see the key. `key`:
   * modifiers and a `KeyboardEvent.code`, joined by `+`, e.g. `Mod+Alt+KeyM` (Mod: Ctrl or Cmd). Unnamed modifiers are not checked.
   */
  registerKeybinding(key: string, command: keyof CommandRegistry): Disposable;
  /**
   * Files from the computer dropped anywhere on the widget (and not taken by a view inside, such as the Visual view
   * taking images). The widget never lets the browser open a dropped file; it shows the drop hint while anyone listens.
   */
  readonly onDidDropFiles: Event<File[]>;
  /** A value remembered for the browser session under this widget's key (`name` tells values apart). */
  remember<T>(name: string): Memory<T>;

  /** The errors and warnings of the newest compilation (null before the first). */
  readonly diagnostics: readonly Diagnostic[] | null;
  readonly onDidChangeDiagnostics: Event<readonly Diagnostic[]>;

  /** INTERIM (until H1 / H2's view contribution points): the shown Typst file and its views; null while another kind of file is shown. */
  readonly activeEditor: ActiveEditor | null;
  /** INTERIM: the selection in a view of a document moved, or its text changed (the views already show the new selection). */
  readonly onDidChangeEditorSelection: Event<TypstDocument>;
  /** Whether the user works in the editing area (the focus is inside it). */
  isEditorFocused(): boolean;
}

export interface OpenOptions {
  /** A range of the Typst file (source offsets) to reveal. */
  selection?: { from: number; to: number };
  /** Reveals in that tab (switching to it); default: the current one. */
  mode?: EditorMode;
}

export interface SidePanelOptions {
  /** Shown on the rail button (as its tooltip and accessible name). */
  label: string;
  /** The rail button's icon. */
  icon: Element;
}

/** A registered side panel: the element its content goes into, and how it opens. */
export interface SidePanel {
  readonly body: HTMLElement;
  /** Opens it by default (unless someone opened or closed it this session, or the widget is narrow). */
  setDefault(open: boolean): void;
  /** Shows or removes it and its rail button altogether (e.g. `fileList: 'hide'`). */
  setAvailable(available: boolean): void;
  /** Closes it if it lies over the editing area (narrow widget), e.g. after something was chosen in it. */
  dismiss(): void;
  dispose(): void;
}

/** A view for one kind of file in the editing area; shown and hidden as files are opened. */
export interface FileView {
  /** Shows `path` (called on every open, also of the shown file: its content may have changed). */
  show(path: ProjectPath, content: FileContent): void;
  hide(): void;
  dispose(): void;
}

export interface FileViewProvider {
  /** Creates the view, into `parent` (the editing area), the first time a file of its kind is opened. */
  createFileView(parent: HTMLElement): FileView;
}

/** INTERIM: the shown Typst file, the view the user works in (by tab) and both of its views. */
export interface ActiveEditor {
  readonly path: ProjectPath;
  readonly document: TypstDocument;
  readonly view: VisualView | SourceView;
  readonly views: readonly [VisualView, SourceView];
}

/**
 * PLACEHOLDER — filled in by H1 at merge with the Visual view's contribution points (node specs, toolbar items,
 * gutters, decorations). Until then one interim bridge to today's `VisualViewOptions`.
 */
export interface VisualViewContributions {
  /** INTERIM: options for the Visual view of each document, merged in registration order, for the views created later. */
  registerDocumentOptions(provider: (document: TypstDocument) => VisualViewOptions): Disposable;
}

/** PLACEHOLDER — filled in by H2 at merge with the Source view's contribution points. */
export interface SourceViewContributions {}

/**
 * PLACEHOLDER — filled in by H2 at merge with the preview's contribution points (toolbar items, PDF variants,
 * overlays). Until then interim bridges to today's `Preview`.
 */
export interface PreviewContributions {
  /** INTERIM: where "Download PDF" gets its file (`PreviewOptions.pdf`); without one there is no button. One source. */
  registerPdfSource(source: PdfSource): Disposable;
  /** INTERIM: the preview's engine (snippets, renders, PDF export); usable once the widget is set up (not during `activate`). */
  readonly engine: Pick<Preview, 'snippet' | 'onRender' | 'exportPdf'>;
}

export { WorkbenchHost, type WorkbenchOptions } from './workbench-host';
export type { EditorMode } from './editing-views/editing-views';
export type { Memory } from './layout/layout';
export { default as workbenchStyles } from './layout/layout.css?inline';
