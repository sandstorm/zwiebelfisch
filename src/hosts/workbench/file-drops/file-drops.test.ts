// @vitest-environment jsdom
// Tests for file-drops.ts.
import { describe, expect, it, vi } from 'vitest';
import { FileDrops } from './file-drops';

// jsdom's File has no arrayBuffer(); the drops only pass the files on
const png = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });

function drop(target: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
  return event;
}

function enter(target: HTMLElement) {
  const event = new Event('dragenter', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } });
  target.dispatchEvent(event);
}

function setup() {
  const target = document.body.appendChild(document.createElement('div'));
  return { target, drops: new FileDrops(target) };
}

describe('FileDrops', () => {
  it('passes dropped files to the listeners and shows the hint until the drop', () => {
    const { target, drops } = setup();
    const dropped = vi.fn();
    drops.onDidDrop(dropped);
    enter(target);
    expect(target.classList.contains('typst-editor--dropping')).toBe(true);
    expect(drop(target, [png]).defaultPrevented).toBe(true);
    expect(dropped).toHaveBeenCalledWith([png]);
    expect(target.classList.contains('typst-editor--dropping')).toBe(false);
  });

  it('leaves drops to an editor inside that takes them (e.g. images dropped into the text); the hint goes away', () => {
    const { target, drops } = setup();
    const dropped = vi.fn();
    drops.onDidDrop(dropped);
    const view = target.appendChild(document.createElement('div'));
    view.addEventListener('drop', (event) => (event.preventDefault(), event.stopPropagation()));
    enter(view);
    drop(view, [png]);
    expect(dropped).not.toHaveBeenCalled();
    expect(target.classList.contains('typst-editor--dropping')).toBe(false);
  });

  it('never makes the browser leave the page, also while nobody listens (and then shows no hint)', () => {
    const { target, drops } = setup();
    const listener = drops.onDidDrop(() => {});
    listener.dispose();
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'] } });
    target.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    enter(target);
    expect(target.classList.contains('typst-editor--dropping')).toBe(false);
    expect(drop(target, [png]).defaultPrevented).toBe(true);
  });

  it('stops listening on dispose', () => {
    const { target, drops } = setup();
    drops.dispose();
    expect(drop(target, [png]).defaultPrevented).toBe(false);
  });
});
