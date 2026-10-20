// ColorScheme: which scheme the widget is shown in, as `data-scheme` for CSS. See WindowHost in ../window-impl.ts
// and docs/30_configuration/02_embedding.typ.
import { isLightText } from '../../../core/color-scheme/color-scheme';

/**
 * Keeps `data-scheme` (`light` | `dark`) on the widget's host: the scheme its colors resolved to
 * (the page's color-scheme, the setting `workbench.theme`, the OS), which CSS alone cannot select on. The
 * stylesheet uses it for what light-dark() cannot express, e.g. inverting the preview's pages.
 * Checked at creation, when the OS scheme changes, and on `update`.
 */
export class ColorScheme {
  private readonly media: MediaQueryList | null;

  constructor(private readonly host: HTMLElement) {
    this.media = host.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    this.media?.addEventListener('change', this.update);
    this.update();
  }

  dispose(): void {
    this.media?.removeEventListener('change', this.update);
    delete this.host.dataset.scheme;
  }

  /** Sets `data-scheme` from the colors as they resolve now (after `data-theme` changed, say). */
  readonly update = (): void => {
    const dark = isLightText(getComputedStyle(this.host).color);
    if (dark !== null) this.host.dataset.scheme = dark ? 'dark' : 'light';
  };
}
