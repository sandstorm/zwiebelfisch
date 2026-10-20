// The preview's zoom and page number in the status bar. See previewControls in ../preview-controls.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { PreviewContributions } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';
import { zoomText } from '../model/zoom';

/**
 * The preview's zoom ("Fit · 83%", "125%") and the page it shows of how many ("3 / 12"; empty without pages), at the
 * right of the status bar, while the pages are shown; kept up to date as the preview scrolls, zooms and renders.
 */
export function registerViewStatus({ preview, window }: ViewStatusContext): Disposable {
  const doc = window.ownerDocument;
  const zoom = item(doc, 'zwf-preview-controls__zoom', 'zwf-preview-zoom');
  const page = item(doc, 'zwf-preview-controls__page-number', 'zwf-preview-page-number');
  const show = () => {
    const pages = preview.activeRenderer === 'pages';
    zoom.hidden = page.hidden = !pages;
    if (!pages) return;
    zoom.textContent = zoomText(preview.zoom, preview.scale);
    const { index, count } = preview.visiblePage;
    page.textContent = count === 0 ? '' : `${index + 1} / ${count}`;
  };
  show();
  return Disposable.from(
    window.registerStatusBarItem(zoom, { alignment: 'right', priority: 30 }),
    window.registerStatusBarItem(page, { alignment: 'right', priority: 20 }),
    preview.onDidChangeView(show),
    preview.onDidChangeRenderers(show),
  );
}

export interface ViewStatusContext {
  readonly preview: Pick<PreviewContributions, 'activeRenderer' | 'zoom' | 'scale' | 'visiblePage' | 'onDidChangeView' | 'onDidChangeRenderers'>;
  readonly window: Pick<WindowApi, 'ownerDocument' | 'registerStatusBarItem'>;
}

function item(doc: Document, className: string, testid: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = className;
  element.dataset.testid = testid;
  return element;
}
