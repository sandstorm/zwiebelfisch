// The preview-controls extension: zoom and the page number in the preview's toolbar.
// Entry of extensions/preview-controls/. See ARCHITECTURE.md, "Preview".
// Why an extension: the preview host keeps the mechanism (zoom, which page is shown) and offers it to toolbar items;
// which controls a widget shows is decided here.
import { pageNumber, zoomControls } from './preview/preview';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './preview-controls.css?inline';

/** Zoom buttons and "page n / total". */
export function previewControls(): TypstExtension {
  return {
    id: 'preview-controls',
    activate({ workbench, preview, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      for (const item of [zoomControls, pageNumber]) subscriptions.push(preview.registerToolbarItem(item));
    },
  };
}
