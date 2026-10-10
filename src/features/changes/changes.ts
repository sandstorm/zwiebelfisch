// ChangeTracking: the base version and the "Changes since …" toggle; both views and the preview mark what changed.
// Entry of features/changes/. See ARCHITECTURE.md, "diffTexts".
import { diffTexts } from './diff';
import type { TypstDocument } from '../../core/typst-document/typst-document';

export { diffTexts, type Change } from './diff';

/** A version to compare with, and how the toggle names it ("Changes since <label>"). */
export interface Base {
  text: string;
  label: string;
}

/** The label of the default base: the text as it was when the editor opened. */
const OPENED = 'opened';

export interface ChangeTargets {
  /** The edited file. */
  document: TypstDocument;
  /** Editing views; each renders the changes against `base` itself (null: none). */
  views: { showChanges(base: string | null): void }[];
  /** Marks the changed ranges of the current text in the preview (null: none). */
  preview(ranges: { from: number; to: number }[] | null): void;
}

/**
 * "Changes since …": the base version to compare with, the toggle button
 * naming it, and keeping every view's change rendering in step with both.
 * Without a given base it compares with the text as opened (toggle off at
 * first). Hidden: when diffs are computed (only while changes are shown).
 */
export class ChangeTracking {
  private readonly button: HTMLButtonElement;
  private base: Base;
  private shown: boolean;
  private readonly unsubscribe: () => void;

  constructor(
    toolbar: HTMLElement,
    private readonly targets: ChangeTargets,
    base: Base | null = null,
  ) {
    this.base = base ?? this.opened();
    this.shown = base !== null;
    this.unsubscribe = targets.document.onChange(() => this.update());
    this.button = toolbar.ownerDocument.createElement('button');
    this.button.type = 'button';
    this.button.className = 'typst-editor__changes';
    this.button.addEventListener('click', () => this.show(!this.shown));
    toolbar.append(this.button);
    this.render();
  }

  /** Compares with `base` from now on and shows the changes; null goes back to the text as opened. */
  setBase(base: Base | null): void {
    if (base?.text === this.base.text && base.label === this.base.label) return;
    this.base = base ?? this.opened();
    this.shown = base !== null || this.shown;
    this.render();
  }

  /**
   * The document's text arrived only now (a collaboration room synced over
   * the local copy): "since opened" starts from it. A given base stays.
   */
  resetOpened(): void {
    if (this.base.label !== OPENED) return;
    this.base = this.opened();
    this.render();
  }

  /** How the current base is named ("opened", "last saved version", …). */
  get label(): string {
    return this.base.label;
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
    if (this.shown) this.targets.preview(this.ranges());
  }

  private opened(): Base {
    return { text: this.targets.document.text, label: OPENED };
  }

  private render(): void {
    this.button.textContent = `Changes since ${this.base.label}`;
    this.button.title = this.shown ? 'Hide the changes' : `Show what changed since ${this.base.label}`;
    this.button.setAttribute('aria-pressed', String(this.shown));
    const base = this.shown ? this.base.text : null;
    for (const view of this.targets.views) view.showChanges(base);
    this.targets.preview(base === null ? null : this.ranges());
  }

  private ranges(): { from: number; to: number }[] {
    return diffTexts(this.base.text, this.targets.document.text).map((change) => ({ from: change.fromB, to: change.toB }));
  }
}
