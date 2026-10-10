// zoomControls: the preview toolbar's zoom buttons and the current zoom; the zoom presets. See ../preview-controls.ts.
import type { PreviewToolbarItem } from '../../../hosts/preview/preview';

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
  shown.className = 'typst-preview__zoom';
  shown.dataset.testid = 'typst-preview-zoom';
  return {
    elements: [...buttons, shown],
    update() {
      const zoom = preview.zoom();
      shown.textContent = zoom === 'fit' ? `Fit · ${zoomLabel(preview.scale())}` : zoomLabel(zoom);
    },
  };
};

const BUTTONS: [label: string, title: string, zoom: 'fit' | number | 'in' | 'out'][] = [
  ['−', 'Zoom out', 'out'],
  ['+', 'Zoom in', 'in'],
  ['Fit', 'Fit width', 'fit'],
  ['100%', 'Actual size', 1],
];

const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** The next preset scale above (`direction` 1) or below (-1) `scale`, clamped to the range. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) return PRESETS.find((preset) => preset > scale + epsilon) ?? PRESETS.at(-1)!;
  return [...PRESETS].reverse().find((preset) => preset < scale - epsilon) ?? PRESETS[0];
}

export function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
