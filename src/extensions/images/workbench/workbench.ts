// The images extension in the workbench: image files open read-only in the editing area (AssetView).
// See ../images.ts.
import type { CustomEditorProvider } from '../../../hosts/window/window';
import { AssetView } from './asset-view';

/** Image files in the editing area, read-only (images get into the text by dragging or "Insert image"). */
export const assetEditor: CustomEditorProvider = {
  resolveCustomEditor(document, panel) {
    const view = new AssetView(panel.element);
    view.show(document.path, document.content);
    panel.onDidDispose(() => view.dispose());
  },
};
