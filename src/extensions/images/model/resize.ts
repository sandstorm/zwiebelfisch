// Resizing an image by dragging a handle. Pure: the image tools measure the pixels. See ImageTools in
// ../visual-editor/image-tools.ts.

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

/** Where a resize drag started: the image's width and the text width (px), and whether the image is centered. */
export interface DragStart {
  width: number;
  reference: number;
  centered: boolean;
}
