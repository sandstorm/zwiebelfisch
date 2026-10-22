// The zoom buttons in the preview's toolbar. See previewControls in ../preview-controls.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Commands } from '../../../hosts/commands/commands';
import type { PreviewContributions, PreviewMenuContext, Zoom } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';
import { stepZoom } from '../model/zoom';

/**
 * Zoom out / in by one preset, fit the width, actual size: buttons in the preview's toolbar (menu `preview/toolbar`,
 * group `3_zoom`) while the pages are shown, and their commands (`previewControls.zoomOut`, `zoomIn`, `zoomFit`,
 * `zoomActualSize`).
 */
export function registerZoomButtons({ preview, window, commands }: ZoomButtonsContext): Disposable {
  const zoom = (to: Zoom | 'in' | 'out') => preview.setZoom(to === 'in' || to === 'out' ? stepZoom(preview.scale, to === 'in' ? 1 : -1) : to);
  return Disposable.from(
    ...BUTTONS.flatMap(([command, shortTitle, title, to], order) => [
      commands.registerCommand(command, () => zoom(to)),
      window.registerMenuItem<PreviewMenuContext>('preview/toolbar', { command, title, shortTitle, group: '3_zoom', order, when: (context) => context.previewRenderer === 'pages' }),
    ]),
  );
}

export interface ZoomButtonsContext {
  readonly preview: Pick<PreviewContributions, 'setZoom' | 'scale'>;
  readonly window: Pick<WindowApi, 'registerMenuItem'>;
  readonly commands: Pick<Commands, 'registerCommand'>;
}

const BUTTONS: [command: string, shortTitle: string, title: string, zoom: Zoom | 'in' | 'out'][] = [
  ['previewControls.zoomOut', '−', 'Zoom out', 'out'],
  ['previewControls.zoomIn', '+', 'Zoom in', 'in'],
  ['previewControls.zoomFit', 'Fit', 'Fit width', 'fit'],
  ['previewControls.zoomActualSize', '100%', 'Actual size', 1],
];
