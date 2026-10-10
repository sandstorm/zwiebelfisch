/** Preview zoom: fit the pane width, or a fixed scale where 1 = 100 % (1 pt = 1/72 in). */
export type Zoom = 'fit' | number;

/** CSS pixels per Typst point (96 dpi / 72 pt per inch). */
export const PX_PER_PT = 96 / 72;

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
