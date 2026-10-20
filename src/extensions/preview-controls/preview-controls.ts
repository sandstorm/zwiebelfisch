import { registerRendererButtons } from './preview/renderer-buttons';
import { registerZoomButtons } from './preview/zoom-buttons';
import { registerViewOptionsMenu } from './window/view-options-menu';
import { registerViewStatus } from './window/view-status';
import type { Extension } from '../../hosts/extension-host/extension-host';
import css from './preview-controls.css?inline';

/**
 * The preview's controls:
 * - a button per renderer ("Pages", "HTML") in its toolbar, pressed while shown
 * - zoom buttons in its toolbar, and the zoom and "page n / total" in the status bar, with the pages only
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
      const onChoose = (id: string) => void globalState.update(RENDERER_KEY, id);
      subscriptions.push(
        registerRendererButtons({ preview, window, commands, onChoose }),
        registerZoomButtons({ preview, window, commands }),
        registerViewStatus({ preview, window }),
        registerViewOptionsMenu({ preview, window, commands, state: globalState }),
      );
    },
  };
}

/** Where the viewer's last choice of renderer is kept (`globalState`). */
const RENDERER_KEY = 'renderer';
