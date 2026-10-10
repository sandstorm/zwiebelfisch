// @vitest-environment jsdom
// Tests for zoom.ts.
import { describe, expect, it } from 'vitest';
import type { PreviewContext, Zoom } from '../preview';
import { stepZoom, zoomControls, zoomLabel } from './zoom';

describe('stepZoom', () => {
  it('goes to the next preset up or down', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
  });
  it('snaps an in-between scale (from fit width) to the neighbouring preset', () => {
    expect(stepZoom(0.83, 1)).toBe(1);
    expect(stepZoom(0.83, -1)).toBe(0.75);
  });
  it('stops at the smallest and largest preset', () => {
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(9, 1)).toBe(4);
  });
});

describe('zoomLabel', () => {
  it('rounds to whole percent', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.834)).toBe('83%');
  });
});

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
