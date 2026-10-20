// @vitest-environment jsdom
// Tests for progress.ts.
import { describe, expect, it } from 'vitest';
import { ProgressLocation } from '../window';
import { ProgressIndicators } from './progress';

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const editingArea = host.appendChild(document.createElement('div'));
  const indicators = new ProgressIndicators(editingArea);
  return { host, editingArea, indicators };
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
  it('lays a note over the editing area, which takes no input, until the task settles (also when it fails)', async () => {
    const { host, editingArea, indicators } = setup();
    const first = pending();
    const second = pending();
    const a = indicators.run({ location: ProgressLocation.EditingArea, title: 'Connecting to the room…' }, () => first.done);
    const b = indicators.run({ location: ProgressLocation.EditingArea, title: 'Again' }, () => second.done);
    const note = host.querySelector<HTMLElement>('[data-testid="zwf-editing-progress"]')!;
    expect(note.previousElementSibling).toBe(editingArea);
    expect(note.querySelector('[role="status"]')!.textContent).toBe('Connecting to the room…');
    expect(editingArea.hasAttribute('inert')).toBe(true);
    expect(editingArea.getAttribute('aria-busy')).toBe('true');

    first.fail(new Error('offline'));
    await expect(a).rejects.toThrow('offline');
    expect(host.querySelectorAll('[data-testid="zwf-editing-progress"]')).toHaveLength(1);
    expect(editingArea.hasAttribute('inert')).toBe(true);
    second.finish();
    await b;
    expect(host.querySelector('[data-testid="zwf-editing-progress"]')).toBeNull();
    expect(editingArea.hasAttribute('inert')).toBe(false);
    expect(editingArea.getAttribute('aria-busy')).toBe('false');
  });
});
