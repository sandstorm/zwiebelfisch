// zoomControls: the preview toolbar's zoom buttons and the current zoom. See previewControls in ../preview-controls.ts.
import type { PreviewToolbarItem } from '../../../hosts/preview/preview';
import { stepZoom, zoomText } from '../model/zoom';

/** Zoom out / in by one preset, fit the width, actual size; then the zoom shown ("Fit · 83%", "125%"). */
export const zoomControls: PreviewToolbarItem = (preview) => {
  const doc = preview.ownerDocument;
  const buttons = BUTTONS.map(([label, title, zoom]) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', () => preview.setZoom(zoom === 'in' || zoom === 'out' ? stepZoom(preview.scale(), zoom === 'in' ? 1 : -1) : zoom));
    return button;
  });
  const shown = doc.createElement('span');
  shown.className = 'zwf-preview-controls__zoom';
  shown.dataset.testid = 'zwf-preview-zoom';
  return {
    elements: [...buttons, shown],
    update() {
      shown.textContent = zoomText(preview.zoom(), preview.scale());
    },
  };
};

const BUTTONS: [label: string, title: string, zoom: 'fit' | number | 'in' | 'out'][] = [
  ['−', 'Zoom out', 'out'],
  ['+', 'Zoom in', 'in'],
  ['Fit', 'Fit width', 'fit'],
  ['100%', 'Actual size', 1],
];
