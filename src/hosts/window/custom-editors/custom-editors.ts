// CustomEditors: which editor shows a file that is not Typst source, by file name pattern and priority
// (`window.registerCustomEditorProvider`, VS Code's custom editors), and the one panel shown. See window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { FileContent } from '../../../core/project/project';
import type { CustomEditorOptions, CustomEditorPanel, CustomEditorProvider } from '../window';
import { FilenamePattern } from './filename-pattern';

/** The priority of a `'default'` editor (and of one registered without a priority). */
const DEFAULT_PRIORITY = 100;

interface Registration {
  readonly viewType: string;
  readonly provider: CustomEditorProvider;
  readonly pattern: FilenamePattern;
  /** null: `'option'`, never chosen by default. */
  readonly priority: number | null;
  readonly icon: string | undefined;
}

/**
 * The custom editors of the editing area. Opening a file picks the editor of the asked view type, or else the one
 * that matches its name with the highest priority (`'default'`: 100; `'option'` editors only when asked for), then
 * the most specific pattern (`*.drawio.png` over `*.png`), then the one registered first; that editor gets a fresh
 * panel for the file. Showing anything else (or the file again) disposes the panel.
 */
export class CustomEditors {
  readonly #registrations: Registration[] = [];
  #shown: { registration: Registration; dispose(): void } | null = null;

  constructor(private readonly parent: HTMLElement) {}

  register(viewType: string, provider: CustomEditorProvider, options: CustomEditorOptions): Disposable {
    if (this.#registrations.some((r) => r.viewType === viewType)) throw new Error(`A custom editor ${viewType} is registered already`);
    const { priority = 'default' } = options;
    const registration: Registration = {
      viewType,
      provider,
      pattern: new FilenamePattern(options.filenamePattern),
      priority: priority === 'option' ? null : priority === 'default' ? DEFAULT_PRIORITY : priority,
      icon: options.icon,
    };
    this.#registrations.push(registration);
    return new Disposable(() => {
      const index = this.#registrations.indexOf(registration);
      if (index >= 0) this.#registrations.splice(index, 1);
      if (this.#shown?.registration === registration) this.#close();
    });
  }

  /**
   * Shows `file` in its editor (`viewType`, or the default one) in a new panel; null (a Typst file is shown) only
   * closes the shown panel. Nothing shows for a file no editor matches.
   */
  show(file: { path: ProjectPath; content: FileContent } | null, viewType?: string): void {
    this.#close();
    const registration = file && this.#choose(file.path, viewType);
    if (!file || !registration) return;
    const element = this.parent.ownerDocument.createElement('div');
    element.className = 'typst-editor__custom-editor';
    element.dataset.viewType = registration.viewType;
    this.parent.append(element);
    const disposed = new EventEmitter<void>();
    const panel: CustomEditorPanel = { element, onDidDispose: disposed.event };
    this.#shown = {
      registration,
      dispose: () => {
        disposed.fire();
        disposed.dispose();
        element.remove();
      },
    };
    registration.provider.resolveCustomEditor({ path: file.path, content: file.content }, panel);
  }

  /** The icon of the editor that opens `path` by default; undefined without one. */
  iconOf(path: ProjectPath): string | undefined {
    return this.#choose(path, undefined)?.icon;
  }

  dispose(): void {
    this.#close();
    this.#registrations.length = 0;
  }

  #close(): void {
    const shown = this.#shown;
    this.#shown = null;
    shown?.dispose();
  }

  #choose(path: ProjectPath, viewType: string | undefined): Registration | undefined {
    if (viewType !== undefined) return this.#registrations.find((r) => r.viewType === viewType);
    let best: Registration | undefined;
    for (const candidate of this.#registrations) {
      if (candidate.priority === null || !candidate.pattern.matches(path)) continue;
      if (!best || ranksAbove(candidate, best)) best = candidate;
    }
    return best;
  }
}

/** Whether `a` wins over `b` (registered earlier): a higher priority, else a more specific pattern. */
function ranksAbove(a: Registration, b: Registration): boolean {
  if (a.priority !== b.priority) return a.priority! > b.priority!;
  return a.pattern.specificity > b.pattern.specificity;
}
