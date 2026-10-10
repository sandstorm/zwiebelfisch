// @vitest-environment jsdom
// Tests for workbench.ts: SourceControlView.
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { SourceControl, SourceControlState } from '../../../hosts/workbench/workbench';
import { SourceControlView } from './workbench';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function setup() {
  const committed: string[] = [];
  const changed = new EventEmitter<void>();
  const sourceControl: SourceControl & { state: SourceControlState } = {
    id: 'gitlab',
    label: 'GitLab',
    defaultCommitMessage: 'Edit via Typst editor',
    state: { busy: false, status: '' },
    onDidChange: changed.event,
    commit: (message) => {
      committed.push(message);
      sourceControl.state = { busy: true, status: 'Saving…' };
      changed.fire();
    },
  };
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new SourceControlView(parent, sourceControl);
  cleanup.push(() => view.destroy(), () => parent.remove());
  const button = parent.querySelector<HTMLButtonElement>('.typst-editor__commit')!;
  const status = parent.querySelector('[role=status]')!;
  const update = (state: SourceControlState) => {
    sourceControl.state = state;
    changed.fire();
  };
  return { parent, button, status, committed, update };
}

describe('SourceControlView', () => {
  it('asks for a commit message, commits, and shows the state', () => {
    const { parent, button, status, committed, update } = setup();
    expect(button.textContent).toBe('Save to GitLab…');
    button.click();
    const form = parent.querySelector<HTMLFormElement>('form[aria-label="Save to GitLab"]')!;
    expect(form.hidden).toBe(false);
    const input = form.querySelector('input')!;
    expect(input.value).toBe('Edit via Typst editor');
    input.value = 'Fix the intro';
    form.requestSubmit();
    expect(committed).toEqual(['Fix the intro']);
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe('Saving…');
    update({ busy: false, status: 'Saved version 01234567 (Ann)' });
    expect(button.disabled).toBe(false);
    expect(status.textContent).toBe('Saved version 01234567 (Ann)');
  });
});
