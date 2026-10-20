import type { Extension } from '../../hosts/workbench/workbench';
import { LoadState } from './load-state';
import { Loader } from './loader';
import css from './preview-progress.css?inline';

/**
 * The preview's loading note: what it waits for ("Loading the Typst compiler… 3.1 / 6.6 MB", "Compiling…", packages
 * and fonts downloading) over the pane while it shows nothing yet (a pane overlay), and a compiler that cannot be
 * loaded or crashed as an error message, once per failure. Without it the pane stays empty while it loads.
 */
export function previewProgress(): Extension {
  return {
    id: 'preview-progress',
    activate({ preview, window, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css));
      const state = new LoadState();
      const loader = new Loader(window.ownerDocument);
      let failed = false;
      const changed = () => {
        const progress = state.current();
        loader.show(preview.isEmpty ? progress : null);
        const failing = progress?.kind === 'failed';
        if (failing && !failed) void window.showErrorMessage(`${progress.title} ${progress.detail ?? ''}`.trim());
        failed = failing;
      };
      subscriptions.push(
        preview.registerPaneOverlay(loader.element),
        preview.onDidLoad((event) => {
          state.apply(event);
          changed();
        }),
        preview.onDidCrash((crash) => {
          state.crashed(crash);
          changed();
        }),
        // a compile answered (pages or errors): no more "Compiling…"
        preview.onDidChangeDiagnostics(() => {
          state.compiled();
          changed();
        }),
        preview.onDidRender(changed),
        preview.onDidChangeRenderers(changed),
      );
      changed();
    },
  };
}
