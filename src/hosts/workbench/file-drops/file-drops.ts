// FileDrops: files from the computer dropped anywhere on the widget (`Workbench.onDidDropFiles`). See ../workbench.ts.
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';

/**
 * Files dragged from the computer onto `target`: the browser never opens them in place of the page (also while
 * nobody listens); while someone does, `typst-editor--dropping` on `target` shows the drop hint, and the files go
 * to the listeners. An editor inside that takes a drop itself (stops it) keeps it; the hint still goes away.
 */
export class FileDrops {
  readonly #dropped = new EventEmitter<File[]>();
  readonly onDidDrop: Event<File[]> = this.#dropped.event;
  #depth = 0;
  readonly #handlers: Record<string, (event: DragEvent) => void> = {
    dragenter: (event) => this.#accepts(event) && this.#setDepth(this.#depth + 1),
    dragleave: (event) => this.#accepts(event) && this.#setDepth(this.#depth - 1),
    dragover: (event) => carriesFiles(event) && event.preventDefault(),
    drop: (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (this.#dropped.hasListeners) this.#dropped.fire([...(event.dataTransfer?.files ?? [])]);
    },
  };

  constructor(private readonly target: HTMLElement) {
    // Captured, so the hint also goes when an editor inside takes the drop.
    target.addEventListener('drop', this.#endHint, true);
    for (const [type, handler] of Object.entries(this.#handlers)) target.addEventListener(type, handler as EventListener);
  }

  dispose(): void {
    this.target.removeEventListener('drop', this.#endHint, true);
    for (const [type, handler] of Object.entries(this.#handlers)) this.target.removeEventListener(type, handler as EventListener);
    this.#setDepth(0);
    this.#dropped.dispose();
  }

  #accepts(event: DragEvent): boolean {
    return carriesFiles(event) && this.#dropped.hasListeners;
  }

  #setDepth(next: number): void {
    this.#depth = Math.max(0, next);
    this.target.classList.toggle('typst-editor--dropping', this.#depth > 0);
  }

  readonly #endHint = () => this.#setDepth(0);
}

function carriesFiles(event: DragEvent): boolean {
  return !!event.dataTransfer?.types.includes('Files');
}
