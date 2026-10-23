// See WindowApi in ../window.ts.
import { Disposable } from '../../../core/disposable/disposable';

/**
 * The band above the editing area's tab bar that extensions put banners into (`window.registerBanner`), as VS Code's
 * workbench banner (Restricted Mode): each banner as wide as the editing area, in registration order; hidden while
 * there is none.
 *
 * @internal Extensions add to it through `window.registerBanner`.
 */
export class Banners {
  readonly #band: HTMLElement;

  /** Puts the band first into `container` (the editing area, before its tab bar). */
  constructor(container: HTMLElement) {
    this.#band = container.ownerDocument.createElement('div');
    this.#band.className = 'zwf-editor__banners';
    this.#band.hidden = true;
    container.prepend(this.#band);
  }

  /** Shows `element` after the banners there are, until disposed. */
  add(element: HTMLElement): Disposable {
    this.#band.append(element);
    this.#band.hidden = false;
    return new Disposable(() => {
      element.remove();
      this.#band.hidden = this.#band.childElementCount === 0;
    });
  }

  dispose(): void {
    this.#band.remove();
  }
}
