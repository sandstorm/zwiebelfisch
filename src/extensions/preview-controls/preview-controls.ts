import { pageNumber } from './preview/page-number';
import { viewMenu } from './preview/view-menu';
import { zoomControls } from './preview/zoom-controls';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './preview-controls.css?inline';

/**
 * Zoom buttons, the "View" menu and "page n / total" in the preview's toolbar.
 *
 * The preview host keeps the mechanism (the zoom, which page is shown, the view options other extensions register)
 * and offers it to toolbar items. Which controls a widget shows is decided here, so a host can leave them out or
 * replace them; the View menu also remembers, per viewer, which view options are on. See
 * docs/30_architecture/06_preview.typ.
 */
export function previewControls(): TypstExtension {
  return {
    id: 'preview-controls',
    activate({ workbench, preview, globalState, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        preview.registerToolbarItem(zoomControls, { group: '2_view', order: 10 }),
        preview.registerToolbarItem(viewMenu(preview, globalState), { group: '2_view', order: 15 }),
        preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20 }),
      );
    },
  };
}
