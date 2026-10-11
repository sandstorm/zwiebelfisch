// pageNumber: "page n / total" at the end of the preview toolbar. See previewControls in ../preview-controls.ts.
import type { PreviewToolbarItem } from '../../../hosts/preview/preview';

/** The page covering most of the viewport and the page count, "3 / 12"; empty without pages. */
export const pageNumber: PreviewToolbarItem = (preview) => {
  const element = preview.ownerDocument.createElement('span');
  element.className = 'typst-preview-controls__page-number';
  element.dataset.testid = 'typst-preview-page-number';
  return {
    elements: [element],
    update() {
      const { index, count } = preview.visiblePage();
      element.textContent = count === 0 ? '' : `${index + 1} / ${count}`;
    },
  };
};
