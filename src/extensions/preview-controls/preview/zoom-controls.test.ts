// @vitest-environment jsdom
// Tests for zoom-controls.ts.
import { describe, expect, it } from 'vitest';
import type { PreviewContext, Zoom } from '../../../hosts/preview/preview';
import { zoomControls } from './zoom-controls';

describe('zoomControls', () => {
  function setup() {
    let zoom: Zoom = 'fit';
    const preview: Partial<PreviewContext> = {
      ownerDocument: document,
      zoom: () => zoom,
      setZoom: (next) => void (zoom = next),
      scale: () => (zoom === 'fit' ? 0.83 : zoom),
    };
    const item = zoomControls(preview as PreviewContext);
    const button = (name: string) => item.elements.find((element) => element.getAttribute('aria-label') === name)!;
    const label = () => {
      item.update!();
      return item.elements.at(-1)!.textContent;
    };
    return { button, label };
  }

  it('shows the zoom, fitting the width or fixed', () => {
    const { button, label } = setup();
    expect(label()).toBe('Fit · 83%');
    button('Actual size').click();
    expect(label()).toBe('100%');
    button('Fit width').click();
    expect(label()).toBe('Fit · 83%');
  });

  it('steps from the current scale to the next preset', () => {
    const { button, label } = setup();
    button('Zoom in').click();
    expect(label()).toBe('100%');
    button('Zoom in').click();
    expect(label()).toBe('125%');
    button('Zoom out').click();
    button('Zoom out').click();
    expect(label()).toBe('75%');
  });
});
