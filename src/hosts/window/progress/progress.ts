// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';
import { type ProgressOptions, type ProgressReport, ProgressLocation } from '../window';
import type { StatusBar } from '../status-bar/status-bar';

/**
 * What `window.withProgress` shows: each running task where its `location` says, until it settles. A status bar entry
 * (`ProgressLocation.Window`), or a note over the editing area that holds input back (`ProgressLocation.EditingArea`).
 *
 * @internal Extensions use it through `window.withProgress`.
 */
export class ProgressIndicators {
  /** The notes of the tasks running over the editing area, oldest first: it is inert while there is one. */
  readonly #notes: HTMLElement[] = [];

  constructor(private readonly places: ProgressPlaces) {}

  async run<R>(options: ProgressOptions, task: (progress: { report(value: ProgressReport): void }) => Promise<R>): Promise<R> {
    const indicator = options.location === ProgressLocation.EditingArea ? this.#overEditingArea(options) : this.#inStatusBar(options);
    try {
      return await task({ report: (value) => indicator.report(value) });
    } finally {
      indicator.dispose();
    }
  }

  /** A spinner and "title: message" on the status bar's right side. */
  #inStatusBar({ title }: ProgressOptions): Indicator {
    const doc = this.places.editingArea.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'zwf-editor__progress';
    element.dataset.testid = 'zwf-progress';
    const meter = new Meter(element, title);
    const spinner = Object.assign(doc.createElement('span'), { className: 'zwf-editor__progress-spinner' });
    spinner.setAttribute('aria-hidden', 'true');
    const label = Object.assign(doc.createElement('span'), { textContent: title ?? '' });
    element.append(spinner, label);
    const item = this.places.statusBar.add(element, { alignment: 'right', priority: 1000 });
    return {
      report: (value) => {
        meter.report(value);
        label.textContent = [title, meter.message].filter(Boolean).join(': ');
      },
      dispose: () => item.dispose(),
    };
  }

  /**
   * A note in the editing area's grid cell, over it: the title (a status), the message and a bar; the editing area is
   * inert meanwhile, so nothing typed there gets lost.
   */
  #overEditingArea({ title }: ProgressOptions): Indicator {
    const area = this.places.editingArea;
    const doc = area.ownerDocument;
    const overlay = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress' });
    overlay.dataset.testid = 'zwf-editing-progress';
    const heading = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress-title', textContent: title ?? '' });
    heading.setAttribute('role', 'status');
    const bar = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress-bar' });
    const meter = new Meter(bar, title);
    const message = Object.assign(doc.createElement('div'), { className: 'zwf-editor__editing-progress-message' });
    overlay.append(heading, bar, message);
    // the newest on top
    (this.#notes.at(-1) ?? area).after(overlay);
    this.#notes.push(overlay);
    this.#hold();
    const released = new Disposable(() => {
      overlay.remove();
      this.#notes.splice(this.#notes.indexOf(overlay), 1);
      this.#hold();
    });
    return {
      report: (value) => {
        meter.report(value);
        message.textContent = meter.message;
      },
      dispose: () => released.dispose(),
    };
  }

  /** Takes every note off the editing area (the window goes; the tasks' promises are theirs). */
  dispose(): void {
    for (const note of this.#notes.splice(0)) note.remove();
    this.#hold();
  }

  #hold(): void {
    const holding = this.#notes.length > 0;
    this.places.editingArea.toggleAttribute('inert', holding);
    this.places.editingArea.setAttribute('aria-busy', String(holding));
  }
}

/** Where progress is shown: the status bar, and the editing area with the grid cell it sits in. */
export interface ProgressPlaces {
  readonly statusBar: StatusBar;
  readonly editingArea: HTMLElement;
}

interface Indicator {
  report(value: ProgressReport): void;
  dispose(): void;
}

/**
 * The `progressbar` role on an element: what a task reported so far — its message, and the increments summed up as
 * `aria-valuenow` (none reported: indeterminate).
 */
class Meter {
  message = '';
  #done: number | null = null;

  constructor(
    private readonly element: HTMLElement,
    title: string | undefined,
  ) {
    element.setAttribute('role', 'progressbar');
    if (title) element.setAttribute('aria-label', title);
    element.setAttribute('aria-valuemin', '0');
    element.setAttribute('aria-valuemax', '100');
  }

  report({ message, increment }: ProgressReport): void {
    if (message !== undefined) this.message = message;
    if (increment !== undefined) this.#done = Math.min(100, (this.#done ?? 0) + increment);
    if (this.message) this.element.setAttribute('aria-valuetext', this.message);
    else this.element.removeAttribute('aria-valuetext');
    if (this.#done !== null) {
      this.element.setAttribute('aria-valuenow', String(Math.round(this.#done)));
      this.element.style.setProperty('--zwf-progress', `${this.#done}%`);
    }
  }
}
