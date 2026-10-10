import { diffTexts } from '../diff/diff';
import type { TypstDocument } from '../core/typst-document/typst-document';

export interface ChangeTargets {
  /** The edited file. */
  document: TypstDocument;
  /** Editing views; each renders the changes against `base` itself (null: none). */
  views: { showChanges(base: string | null): void }[];
  /** Marks the changed ranges of the current text in the preview (null: none). */
  preview(ranges: { from: number; to: number }[] | null): void;
}

/**
 * "Show changes": the base version to compare with, the toggle button, and
 * keeping every view's change rendering in step with both. Hidden: when diffs
 * are computed (only while changes are shown).
 */
export class ChangeTracking {
  private readonly button: HTMLButtonElement;
  private shown = true;
  private readonly unsubscribe: () => void;

  constructor(
    toolbar: HTMLElement,
    private readonly targets: ChangeTargets,
    private base: string | null = null,
  ) {
    this.unsubscribe = targets.document.onChange(() => this.update());
    this.button = toolbar.ownerDocument.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-editor__changes';
    this.button.textContent = 'Show changes';
    this.button.addEventListener('click', () => this.show(!this.shown));
    toolbar.append(this.button);
    this.render();
  }

  /** Compares with `base` from now on (null: nothing to compare with) and shows the changes. */
  setBase(base: string | null): void {
    if (base === this.base) return;
    this.base = base;
    this.shown = true;
    this.render();
  }

  show(shown: boolean): void {
    this.shown = shown;
    this.render();
  }

  destroy(): void {
    this.unsubscribe();
    this.button.remove();
  }

  private update(): void {
    if (this.active()) this.targets.preview(this.ranges());
  }

  private active(): boolean {
    return this.base !== null && this.shown;
  }

  private render(): void {
    this.button.hidden = this.base === null;
    this.button.setAttribute('aria-pressed', String(this.shown));
    const base = this.active() ? this.base : null;
    for (const view of this.targets.views) view.showChanges(base);
    this.targets.preview(base === null ? null : this.ranges());
  }

  private ranges(): { from: number; to: number }[] {
    return diffTexts(this.base ?? '', this.targets.document.text).map((change) => ({ from: change.fromB, to: change.toB }));
  }
}
