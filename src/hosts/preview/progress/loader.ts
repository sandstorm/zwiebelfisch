// Loader: the preview pane's "Loading the Typst compiler… 3.1 / 6.6 MB" while it has no pages yet. See Preview in
// ../preview.ts.
import type { PreviewProgress } from '../preview';

/**
 * Shows a `PreviewProgress` over the (empty) pages: its title as a status (announced when the phase changes, not per
 * byte), a progress bar (determinate with `fraction`, else indeterminate; none for a failure) and the detail.
 * Laid over the pane, so it never moves anything.
 *
 * @internal The preview pane's own loading note; extensions do not reach it.
 */
export class Loader {
  readonly element: HTMLElement;
  readonly #title: HTMLElement;
  readonly #bar: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #detail: HTMLElement;

  constructor(doc: Document) {
    const part = (className: string) => Object.assign(doc.createElement('div'), { className });
    this.element = part('zwf-preview__loader');
    this.element.dataset.testid = 'zwf-preview-loader';
    this.element.hidden = true;
    this.#title = part('zwf-preview__loader-title');
    this.#title.setAttribute('role', 'status');
    this.#bar = part('zwf-preview__loader-bar');
    this.#bar.setAttribute('role', 'progressbar');
    this.#bar.setAttribute('aria-valuemin', '0');
    this.#bar.setAttribute('aria-valuemax', '100');
    this.#fill = part('zwf-preview__loader-fill');
    this.#bar.append(this.#fill);
    this.#detail = part('zwf-preview__loader-detail');
    this.#detail.setAttribute('aria-hidden', 'true');
    this.element.append(this.#title, this.#bar, this.#detail);
  }

  /** Shows `progress`, or nothing (null). */
  show(progress: PreviewProgress | null): void {
    this.element.hidden = progress === null;
    if (!progress) return;
    const failed = progress.kind === 'failed';
    this.element.classList.toggle('zwf-preview__loader--failed', failed);
    if (this.#title.textContent !== progress.title) this.#title.textContent = progress.title;
    this.#detail.textContent = progress.detail ?? '';
    this.#bar.hidden = failed;
    this.#bar.setAttribute('aria-label', progress.title);
    const { fraction } = progress;
    this.#bar.classList.toggle('zwf-preview__loader-bar--indeterminate', fraction === null);
    if (fraction === null) {
      this.#bar.removeAttribute('aria-valuenow');
      this.#fill.style.width = '';
    } else {
      this.#bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      this.#fill.style.width = `${fraction * 100}%`;
    }
    if (progress.detail) this.#bar.setAttribute('aria-valuetext', progress.detail);
    else this.#bar.removeAttribute('aria-valuetext');
  }
}
