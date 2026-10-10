// The images extension in the workbench: images and data files open read-only in the editing area (AssetView).
// Entry of extensions/images/workbench/. See ../images.ts.
import type { FileViewProvider, TypstExtension } from '../../../hosts/workbench/workbench';
import { AssetView } from './asset-view';

/** Images and data files in the editing area, read-only (images get into the text by dragging or "Insert image"). */
export function assets(): TypstExtension {
  return {
    id: 'assets',
    activate({ workbench, subscriptions }) {
      const provider: FileViewProvider = {
        createFileView: (parent) => {
          const view = new AssetView(parent);
          return { show: (path, content) => view.show(path, content), hide: () => view.hide(), dispose: () => view.destroy() };
        },
      };
      subscriptions.push(workbench.registerFileView('image', provider), workbench.registerFileView('data', provider));
    },
  };
}
