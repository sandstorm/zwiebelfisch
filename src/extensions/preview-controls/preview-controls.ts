import { pageNumber } from './preview/page-number';
import { rendererSwitch } from './preview/renderer-switch';
import { zoomControls } from './preview/zoom-controls';
import { registerViewOptionsMenu } from './window/view-options-menu';
import type { Extension } from '../../hosts/extension-host/extension-host';
import css from './preview-controls.css?inline';

/**
 * The preview's controls:
 * - a switch between its renderers ("Pages | HTML") in the toolbar
 * - zoom buttons and "page n / total" in the toolbar, shown with the pages only
 * - an entry per view option in the View menu (menu `view`, group `preview`)
 *
 * The renderer chosen last and which view options are on are remembered per viewer, also for renderers and options
 * registered after this extension.
 */
export function previewControls(): Extension {
  return {
    id: 'preview-controls',
    activate({ window, preview, commands, globalState, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css));
      const chosen = globalState.get<unknown>(RENDERER_KEY);
      if (typeof chosen === 'string') preview.setActiveRenderer(chosen);
      const remember = (id: string) => void globalState.update(RENDERER_KEY, id);
      subscriptions.push(
        preview.registerToolbarItem(rendererSwitch(preview, remember), { group: '2_view', order: 0 }),
        preview.registerToolbarItem(zoomControls, { group: '2_view', order: 10, renderer: 'pages' }),
        preview.registerToolbarItem(pageNumber, { group: '2_view', order: 20, renderer: 'pages' }),
        registerViewOptionsMenu({ preview, window, commands, state: globalState }),
      );
    },
  };
}

/** Where the viewer's last choice of renderer is kept (`globalState`). */
const RENDERER_KEY = 'renderer';
