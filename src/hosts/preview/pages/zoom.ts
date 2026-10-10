// Preview zoom: the zoom value and the pt → px scale. See pages.ts.
/** Preview zoom: fit the pane width, or a fixed scale where 1 = 100 % (1 pt = 1/72 in). */
export type Zoom = 'fit' | number;

/** CSS pixels per Typst point (96 dpi / 72 pt per inch). */
export const PX_PER_PT = 96 / 72;
