// The zoom presets and how a zoom is named. Pure. See ../preview-controls.ts.

const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** The next preset scale above (`direction` 1) or below (-1) `scale`, clamped to the range. */
export function stepZoom(scale: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) return PRESETS.find((preset) => preset > scale + epsilon) ?? PRESETS.at(-1)!;
  return [...PRESETS].reverse().find((preset) => preset < scale - epsilon) ?? PRESETS[0];
}

/** The zoom as the toolbar shows it: "Fit · 83%" while fitting the width (at `scale`), else "125%". */
export function zoomText(zoom: 'fit' | number, scale: number): string {
  return zoom === 'fit' ? `Fit · ${zoomLabel(scale)}` : zoomLabel(zoom);
}

function zoomLabel(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}
