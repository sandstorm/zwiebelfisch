// @vitest-environment jsdom
// Tests for progress.ts.
import { describe, expect, it } from 'vitest';
import { StatusBar } from '../status-bar/status-bar';
import { ProgressLocation } from '../window';
import { ProgressIndicators } from './progress';

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const editingArea = host.appendChild(document.createElement('div'));
  const bar = host.appendChild(document.createElement('div'));
  const indicators = new ProgressIndicators({ statusBar: new StatusBar(bar), editingArea });
  return { host, editingArea, bar, indicators };
}

/** A task that runs until `finish` is called. */
function pending() {
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { done, finish, fail };
}

describe('ProgressIndicators', () => {
  it('shows a window task in the status bar with its title and message until it settles, resolving to its result', async () => {
    const { bar, indicators } = setup();
    const { done, finish } = pending();
    const result = indicators.run({ location: ProgressLocation.Window, title: 'Typst' }, async (progress) => {
      progress.report({ message: '3.1 / 6.6 MB' });
      await done;
      return 42;
    });
    const item = bar.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(item.textContent).toBe('Typst: 3.1 / 6.6 MB');
    expect(item.getAttribute('aria-label')).toBe('Typst');
    expect(item.getAttribute('aria-valuetext')).toBe('3.1 / 6.6 MB');
    expect(item.hasAttribute('aria-valuenow')).toBe(false);
    finish();
    expect(await result).toBe(42);
    expect(bar.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('sums the increments up as the value', async () => {
    const { bar, indicators } = setup();
    const { done, finish } = pending();
    const result = indicators.run({ location: ProgressLocation.Window }, async (progress) => {
      progress.report({ increment: 30 });
      progress.report({ increment: 25, message: 'half' });
      await done;
    });
    const item = bar.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(item.getAttribute('aria-valuenow')).toBe('55');
    expect(item.textContent).toBe('half');
    finish();
    await result;
  });

  it('lays a note over the editing area, which takes no input, until the task settles (also when it fails)', async () => {
    const { host, editingArea, indicators } = setup();
    const first = pending();
    const second = pending();
    const a = indicators.run({ location: ProgressLocation.EditingArea, title: 'Connecting to the room…' }, () => first.done);
    const b = indicators.run({ location: ProgressLocation.EditingArea, title: 'Again' }, () => second.done);
    const note = host.querySelector<HTMLElement>('[data-testid="typst-editing-progress"]')!;
    expect(note.previousElementSibling).toBe(editingArea);
    expect(note.querySelector('[role="status"]')!.textContent).toBe('Connecting to the room…');
    expect(editingArea.hasAttribute('inert')).toBe(true);
    expect(editingArea.getAttribute('aria-busy')).toBe('true');

    first.fail(new Error('offline'));
    await expect(a).rejects.toThrow('offline');
    expect(host.querySelectorAll('[data-testid="typst-editing-progress"]')).toHaveLength(1);
    expect(editingArea.hasAttribute('inert')).toBe(true);
    second.finish();
    await b;
    expect(host.querySelector('[data-testid="typst-editing-progress"]')).toBeNull();
    expect(editingArea.hasAttribute('inert')).toBe(false);
    expect(editingArea.getAttribute('aria-busy')).toBe('false');
  });
});
