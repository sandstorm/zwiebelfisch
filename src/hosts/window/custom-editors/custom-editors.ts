// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileChange, FileContent } from '../../../core/project/project';
import type { SourceRange } from '../../../core/typst-document/typst-document';
import type { CustomEditorOptions, CustomEditorPanel, CustomEditorProvider, TextEditor } from '../window';
import { FilenamePattern } from './filename-pattern';

/**
 * The custom editors of the editing area (`window.registerCustomEditorProvider`, VS Code's custom editors): which
 * editor shows a file, the editors a file can be switched between, and the panels. Opening a file picks the editor
 * asked for (`viewType`), else the one the user chose last among those offered for the file, else the one that matches
 * its name with the highest priority (`'default'`: 100), then the most specific pattern (`*.drawio.png` over `*.png`),
 * then the one registered first; `'fallback'` editors only open files no other editor matches, `'option'` editors only
 * when asked for. That editor gets a fresh panel for the file; showing anything else disposes it, or only hides it for
 * an editor with `retainContextWhenHidden` (shown again when that file opens in it again, disposed when the file is
 * deleted).
 */
export class CustomEditors {
  readonly #registrations: Registration[] = [];
  /** View types asked for, the latest first: the user's choice when a file offers several editors. */
  readonly #chosen: string[] = [];
  /** The panels of editors that keep them while hidden, the shown one included. */
  readonly #retained: Panel[] = [];
  #shown: Panel | null = null;

  constructor(private readonly parent: HTMLElement) {}

  register(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable {
    if (this.#registrations.some((r) => r.viewType === viewType)) throw new Error(`A custom editor ${viewType} is registered already`);
    const { priority = 'default' } = options;
    const registration: Registration = {
      viewType,
      displayName: options.displayName,
      provider,
      pattern: new FilenamePattern(options.filenamePattern),
      role: priority === 'option' || priority === 'fallback' ? priority : 'ranked',
      priority: typeof priority === 'number' ? priority : DEFAULT_PRIORITY,
      icon: options.icon,
      retainContextWhenHidden: options.retainContextWhenHidden ?? false,
    };
    this.#registrations.push(registration);
    return new Disposable(() => {
      const index = this.#registrations.indexOf(registration);
      if (index >= 0) this.#registrations.splice(index, 1);
      for (const panel of this.#retained.filter((p) => p.registration === registration)) this.#dispose(panel);
      if (this.#shown?.registration === registration) this.#dispose(this.#shown);
    });
  }

  /**
   * Shows `file` in its editor (`viewType` if it matches the file, else the one chosen as above), then asks it to
   * reveal `selection` (`onDidRequestReveal`). Resolves to the view type shown; undefined (nothing shown) for a file no
   * editor matches.
   */
  show(file: { path: ProjectPath; content: FileContent }, viewType?: string, selection?: SourceRange): string | undefined {
    const registration = this.#choose(file.path, viewType);
    if (registration && viewType === registration.viewType) this.#choice(viewType);
    const retained = registration && this.#retained.find((p) => p.registration === registration && p.path === file.path);
    if (this.#shown && this.#shown !== retained) this.#hide(this.#shown);
    if (!registration) return undefined;
    const panel = retained ?? this.#open(registration, file);
    if (retained) {
      this.#shown = retained;
      retained.setVisible(true);
    }
    if (selection) panel.reveal(selection);
    return registration.viewType;
  }

  /** A new panel for `file`, shown, filled by `registration`'s editor. */
  #open(registration: Registration, file: { path: ProjectPath; content: FileContent }): Panel {
    const panel = new Panel(this.parent, registration, file.path);
    if (registration.retainContextWhenHidden) this.#retained.push(panel);
    this.#shown = panel;
    registration.provider.resolveCustomEditor({ path: file.path, content: file.content }, panel);
    return panel;
  }

  /** The panel shown; null while none is. */
  get shown(): CustomEditorPanel | null {
    return this.#shown;
  }

  /**
   * The editors `path` can be shown in, best first: those matching it, apart from fallbacks, which only open files
   * nothing else does.
   */
  choicesFor(path: ProjectPath): readonly CustomEditorChoice[] {
    return this.#ranked(path)
      .filter((r) => r.role !== 'fallback')
      .map(({ viewType, displayName }) => ({ viewType, displayName }));
  }

  /** The icon of the editor that opens `path` by default; undefined without one. */
  iconOf(path: ProjectPath): string | undefined {
    return this.#ranked(path).find((r) => r.role !== 'option')?.icon;
  }

  /** Keeps the retained panels with their file: disposed when it is deleted, kept when it is renamed. */
  followFileChange(change: FileChange): void {
    if (change.kind === 'delete') {
      for (const panel of this.#retained.filter((p) => p.path === change.path)) this.#dispose(panel);
    } else if (change.kind === 'rename') {
      for (const panel of this.#retained) if (panel.path === change.from) panel.path = change.path;
    }
  }

  dispose(): void {
    if (this.#shown) this.#dispose(this.#shown);
    for (const panel of [...this.#retained]) this.#dispose(panel);
    this.#registrations.length = 0;
  }

  #choose(path: ProjectPath, viewType: string | undefined): Registration | undefined {
    const ranked = this.#ranked(path);
    const asked = ranked.find((r) => r.viewType === viewType);
    if (asked) return asked;
    const offered = this.choicesFor(path).map((choice) => choice.viewType);
    const chosen = this.#chosen.find((type) => offered.includes(type));
    return ranked.find((r) => r.viewType === chosen) ?? ranked.find((r) => r.role !== 'option');
  }

  /**
   * The editors matching `path`, best first: ranked, fallback, option editors; the higher priority, the more specific
   * pattern, the one registered first.
   */
  #ranked(path: ProjectPath): Registration[] {
    return this.#registrations.filter((r) => r.pattern.matches(path)).sort((a, b) => ranksAbove(b, a) - ranksAbove(a, b));
  }

  #choice(viewType: string): void {
    const index = this.#chosen.indexOf(viewType);
    if (index >= 0) this.#chosen.splice(index, 1);
    this.#chosen.unshift(viewType);
  }

  #hide(panel: Panel): void {
    if (this.#retained.includes(panel)) {
      this.#shown = null;
      panel.setVisible(false);
    } else this.#dispose(panel);
  }

  #dispose(panel: Panel): void {
    const index = this.#retained.indexOf(panel);
    if (index >= 0) this.#retained.splice(index, 1);
    if (this.#shown === panel) this.#shown = null;
    panel.dispose();
  }
}

/** An editor the user can switch the shown file to (the editing area's tabs). */
export interface CustomEditorChoice {
  readonly viewType: string;
  readonly displayName: string;
}

interface Registration {
  readonly viewType: string;
  readonly displayName: string;
  readonly provider: CustomEditorProvider;
  readonly pattern: FilenamePattern;
  readonly role: Role;
  /** Orders the ranked editors (higher first). */
  readonly priority: number;
  readonly icon: string | undefined;
  readonly retainContextWhenHidden: boolean;
}

/**
 * How an editor takes part in opening files: `ranked` ones by default (in `priority` order), `fallback` ones only files
 * no ranked one matches, `option` ones only when chosen.
 */
type Role = 'ranked' | 'fallback' | 'option';

/** A panel of the editing area; hidden rather than disposed for an editor that retains its context. */
class Panel implements CustomEditorPanel {
  readonly element: HTMLElement;
  readonly #viewState = new EventEmitter<void>();
  readonly #disposed = new EventEmitter<void>();
  readonly #reveal = new EventEmitter<SourceRange>();
  readonly onDidChangeViewState = this.#viewState.event;
  readonly onDidDispose = this.#disposed.event;
  readonly onDidRequestReveal = this.#reveal.event;
  textEditor?: TextEditor;
  contentElement?: Element;

  constructor(
    parent: HTMLElement,
    readonly registration: Registration,
    /** The file shown; follows a rename while retained. */
    public path: ProjectPath,
  ) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.className = 'zwf-editor__custom-editor';
    this.element.dataset.viewType = registration.viewType;
    parent.append(this.element);
  }

  get visible(): boolean {
    return !this.element.hidden;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.element.hidden = !visible;
    this.#viewState.fire();
  }

  reveal(range: SourceRange): void {
    this.#reveal.fire(range);
  }

  dispose(): void {
    this.#disposed.fire();
    this.#disposed.dispose();
    this.#viewState.dispose();
    this.#reveal.dispose();
    this.element.remove();
  }
}

/** The priority of a `'default'` editor (and of one registered without a priority). */
const DEFAULT_PRIORITY = 100;

/**
 * 1 if `a` comes before `b` regardless of registration order (an earlier role, a higher priority, a more specific
 * pattern), else 0.
 */
function ranksAbove(a: Registration, b: Registration): number {
  if (a.role !== b.role) return Number(ROLES.indexOf(a.role) < ROLES.indexOf(b.role));
  if (a.priority !== b.priority) return Number(a.priority > b.priority);
  return Number(a.pattern.specificity > b.pattern.specificity);
}

/** The roles, the one opening files first. */
const ROLES: readonly Role[] = ['ranked', 'fallback', 'option'];
