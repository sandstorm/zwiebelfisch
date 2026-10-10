// ColorScheme: which scheme the widget is shown in, as `data-scheme` for CSS. See ARCHITECTURE.md, "Dark mode".
import { isLightText } from '../../../ui/color-scheme/color-scheme';

/**
 * Keeps `data-scheme` (`light` | `dark`) on the widget's host: the scheme its colors resolved to
 * (the page's color-scheme, the `theme` option, the OS), which CSS alone cannot select on. The
 * stylesheet uses it for what light-dark() cannot express, e.g. inverting the preview's pages.
 * Checked at creation and when the OS scheme changes.
 */
export class ColorScheme {
  private readonly media: MediaQueryList | null;

  constructor(readonly host: HTMLElement) {
    this.media = host.ownerDocument.defaultView?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    this.media?.addEventListener('change', this.check);
    this.check();
  }

  destroy(): void {
    this.media?.removeEventListener('change', this.check);
    delete this.host.dataset.scheme;
  }

  private readonly check = () => {
    const dark = isLightText(getComputedStyle(this.host).color);
    if (dark !== null) this.host.dataset.scheme = dark ? 'dark' : 'light';
  };
}
