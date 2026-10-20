// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { ProgressOptions } from '../window';

/**
 * What `window.withProgress` shows: a note over the editing area for each running task, until it settles; the editing
 * area takes no input meanwhile.
 *
 * @internal Extensions use it through `window.withProgress`.
 */
export class ProgressIndicators {
  /** The notes of the tasks running, oldest first: the editing area is inert while there is one. */
  readonly #notes: HTMLElement[] = [];

  constructor(private readonly editingArea: HTMLElement) {}

  async run<R>(options: ProgressOptions, task: () => Promise<R>): Promise<R> {
    const note = this.#overEditingArea(options);
    try {
      return await task();
    } finally {
      note.dispose();
    }
  }

  /** A note in the editing area's grid cell, over it: the title (a status) and a moving bar. */
  #overEditingArea({ title }: ProgressOptions): Disposable {
    const doc = this.editingArea.ownerDocument;
    const overlay = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress' });
    overlay.dataset.testid = 'zwf-editing-progress';
    const heading = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress-title', textContent: title ?? '' });
    heading.setAttribute('role', 'status');
    const bar = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress-bar' });
    bar.setAttribute('aria-hidden', 'true');
    overlay.append(heading, bar);
    // the newest on top
    (this.#notes.at(-1) ?? this.editingArea).after(overlay);
    this.#notes.push(overlay);
    this.#hold();
    return new Disposable(() => {
      overlay.remove();
      this.#notes.splice(this.#notes.indexOf(overlay), 1);
      this.#hold();
    });
  }

  /** Takes every note off the editing area (the window goes; the tasks' promises are theirs). */
  dispose(): void {
    for (const note of this.#notes.splice(0)) note.remove();
    this.#hold();
  }

  #hold(): void {
    const holding = this.#notes.length > 0;
    this.editingArea.toggleAttribute('inert', holding);
    this.editingArea.setAttribute('aria-busy', String(holding));
  }
}
