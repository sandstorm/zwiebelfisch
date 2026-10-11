// Resizing an image by dragging a handle: the width it gets, in whole percent of the text width. Pure: the image tools
// (visual-editor/image-tools.ts) measure the pixels. See ../images.ts.

/** Where a resize drag started: the image's width and the text width (px), and whether the image is centered. */
export interface DragStart {
  width: number;
  reference: number;
  centered: boolean;
}

/**
 * The new width in percent of the text width after dragging a handle by `dx`
 * pixels: `direction` is -1 for handles on the left. A centered image grows
 * on both sides, so it changes by twice the drag. Whole percent, 1 to 100.
 */
export function resizedPercent({ width, reference, centered }: DragStart, dx: number, direction: 1 | -1): number {
  if (reference <= 0) return 100;
  const dragged = width + dx * direction * (centered ? 2 : 1);
  return Math.min(100, Math.max(1, Math.round((dragged / reference) * 100)));
}
