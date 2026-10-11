// The preview-controls extension. Entry of extensions/preview-controls/. See docs/30_architecture/06_preview.typ.
import { pageNumber } from './preview/page-number';
import { zoomControls } from './preview/zoom-controls';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './preview-controls.css?inline';

/**
 * Zoom buttons and "page n / total".
 *
 * Zoom and the page number in the preview's toolbar.
 *
 * Why an extension: the preview host keeps the mechanism (zoom, which page is shown) and offers it to toolbar items;
 * which controls a widget shows is decided here.
 */
export function previewControls(): TypstExtension {
  return {
    id: 'preview-controls',
    activate({ workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        preview.registerToolbarItem(zoomControls, { group: '2_view', order: 10 }),
        preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20 }),
      );
    },
  };
}
