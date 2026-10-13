// rendererSwitch: "Pages | HTML" in the preview toolbar. See previewControls in ../preview-controls.ts.
import type { PreviewContributions, PreviewToolbarItem } from '../../../hosts/preview/preview';

/**
 * A button per renderer the preview has (the pages and the registered ones), the active one pressed; a click shows
 * that renderer and tells `onChoose`. Hidden while there is only the pages.
 */
export function rendererSwitch(preview: Pick<PreviewContributions, 'renderers' | 'activeRenderer' | 'setActiveRenderer' | 'onDidChangeRenderers'>, onChoose: (id: string) => void): PreviewToolbarItem {
  return ({ ownerDocument: doc }) => {
    const group = doc.createElement('span');
    group.className = 'zwf-preview-controls__renderers';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Preview as');
    group.dataset.testid = 'zwf-preview-renderers';
    const show = () => {
      const renderers = preview.renderers();
      group.hidden = renderers.length < 2;
      group.replaceChildren(
        ...renderers.map(({ id, label }) => {
          const button = doc.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.setAttribute('aria-pressed', String(id === preview.activeRenderer));
          button.addEventListener('click', () => {
            preview.setActiveRenderer(id);
            onChoose(id);
          });
          return button;
        }),
      );
    };
    show();
    const listening = preview.onDidChangeRenderers(show);
    return { elements: [group], dispose: () => listening.dispose() };
  };
}
