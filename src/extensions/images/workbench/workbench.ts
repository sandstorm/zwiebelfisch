// The images extension in the workbench: images and other files open read-only in the editing area (AssetView).
// Entry of extensions/images/workbench/. See ../images.ts.
import type { CustomEditorProvider } from '../../../hosts/workbench/workbench';
import { AssetView } from './asset-view';

/** Images and other files in the editing area, read-only (images get into the text by dragging or "Insert image"). */
export const assetEditor: CustomEditorProvider = {
  resolveCustomEditor(document, panel) {
    const view = new AssetView(panel.element);
    view.show(document.path, document.content);
    panel.onDidDispose(() => view.destroy());
  },
};
