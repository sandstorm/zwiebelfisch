// The renderers' buttons in the preview's toolbar ("Pages", "HTML"). See previewControls in ../preview-controls.ts.
import { Disposable } from '../../../core/disposable/disposable';
import type { Commands } from '../../../hosts/commands/commands';
import type { PreviewContributions, PreviewMenuContext } from '../../../hosts/preview/preview';
import type { WindowApi } from '../../../hosts/window/window';

/**
 * A button per renderer in the preview's toolbar (menu `preview/title`, group `2_renderers`; the pages first, then
 * the registered ones; none while there are only the pages), pressed while it is shown. Its command
 * `previewControls.showRenderer.<id>` shows that renderer and tells `onChoose`.
 */
export function registerRendererButtons({ preview, window, commands, onChoose }: RendererButtonsContext): Disposable {
  let shown = '';
  let buttons = Disposable.from();
  const show = () => {
    const renderers = preview.renderers();
    const now = JSON.stringify(renderers);
    if (now === shown) return;
    shown = now;
    buttons.dispose();
    const button = ({ id, label }: { id: string; label: string }, order: number) => {
      const command = `${SHOW}.${id}`;
      return Disposable.from(
        commands.registerCommand(command, () => {
          preview.setActiveRenderer(id);
          onChoose(id);
        }),
        window.registerMenuItem<PreviewMenuContext>('preview/title', { command, title: label, group: '2_renderers', order, toggled: (context) => context.previewRenderer === id }),
      );
    };
    buttons = Disposable.from(...(renderers.length < 2 ? [] : renderers.map(button)));
  };
  show();
  const subscription = preview.onDidChangeRenderers(show);
  return new Disposable(() => {
    subscription.dispose();
    buttons.dispose();
  });
}

export interface RendererButtonsContext {
  readonly preview: Pick<PreviewContributions, 'renderers' | 'setActiveRenderer' | 'onDidChangeRenderers'>;
  readonly window: Pick<WindowApi, 'registerMenuItem'>;
  readonly commands: Pick<Commands, 'registerCommand'>;
  /** The user chose renderer `id`. */
  onChoose(id: string): void;
}

/** The prefix of the buttons' commands; the renderer's id follows. */
const SHOW = 'previewControls.showRenderer';
