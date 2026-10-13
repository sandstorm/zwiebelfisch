import { pageNumber } from './preview/page-number';
import { rendererSwitch } from './preview/renderer-switch';
import { zoomControls } from './preview/zoom-controls';
import { registerViewOptionsMenu } from './workbench/view-options-menu';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './preview-controls.css?inline';

/**
 * Zoom buttons and "page n / total" in the preview's toolbar, and a switch between the preview's renderers ("Pages |
 * HTML"); the preview's view options in the View menu.
 *
 * The preview host keeps the mechanism (the zoom, which page is shown, the renderers and view options other extensions
 * register) and offers it to toolbar items. Which controls a widget shows is decided here, so a host can leave them out
 * or replace them. Zoom and page number are the pages' and hidden with another renderer. The renderer chosen last is
 * remembered per viewer, also one registered after this extension. Every view option gets an entry in the View menu at
 * the top right of the editing area (menu `view`, group `preview`, below what the editors contribute there); which are
 * on is remembered per viewer. See docs/40_architecture/06_preview.typ.
 */
export function previewControls(): Extension {
  return {
    id: 'preview-controls',
    activate({ workbench, preview, commands, globalState, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      const chosen = globalState.get<unknown>(RENDERER_KEY);
      if (typeof chosen === 'string') preview.setActiveRenderer(chosen);
      const remember = (id: string) => void globalState.update(RENDERER_KEY, id);
      subscriptions.push(
        preview.registerToolbarItem(rendererSwitch(preview, remember), { group: '2_view', order: 0 }),
        preview.registerToolbarItem(zoomControls, { group: '2_view', order: 10, renderer: 'pages' }),
        preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20, renderer: 'pages' }),
        registerViewOptionsMenu({ preview, workbench, commands, state: globalState }),
      );
    },
  };
}

/** Where the viewer's last choice of renderer is kept (`globalState`). */
const RENDERER_KEY = 'renderer';
