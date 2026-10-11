import { pageNumber } from './preview/page-number';
import { zoomControls } from './preview/zoom-controls';
import { registerViewOptionsMenu } from './workbench/view-options-menu';
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './preview-controls.css?inline';

/**
 * Zoom buttons and "page n / total" in the preview's toolbar; the preview's view options in the View menu.
 *
 * The preview host keeps the mechanism (the zoom, which page is shown, the view options other extensions register)
 * and offers it to toolbar items. Which controls a widget shows is decided here, so a host can leave them out or
 * replace them. Every view option gets an entry in the View menu at the top right of the editing area (menu `view`,
 * group `preview`, below what the editors contribute there); which are on is remembered per viewer. See
 * docs/30_architecture/06_preview.typ.
 */
export function previewControls(): TypstExtension {
  return {
    id: 'preview-controls',
    activate({ workbench, preview, commands, globalState, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        preview.registerToolbarItem(zoomControls, { group: '2_view', order: 10 }),
        preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20 }),
        registerViewOptionsMenu({ preview, workbench, commands, state: globalState }),
      );
    },
  };
}
