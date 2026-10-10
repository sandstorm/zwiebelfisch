// Tests for source-controls.ts.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { SourceControl } from '../workbench';
import { SourceControls } from './source-controls';

const sourceControl = (id: string): SourceControl => ({
  id,
  label: id,
  state: { busy: false, status: '' },
  onDidChange: () => new Disposable(() => {}),
  commit() {},
});

describe('SourceControls', () => {
  it('lists the registered source controls in order and tells when one comes or goes', () => {
    const controls = new SourceControls();
    let changes = 0;
    controls.onDidChange(() => changes++);
    const gitlab = sourceControl('gitlab');
    const registration = controls.register(gitlab);
    controls.register(sourceControl('other'));
    expect(controls.all.map((control) => control.id)).toEqual(['gitlab', 'other']);
    registration.dispose();
    registration.dispose();
    expect(controls.all.map((control) => control.id)).toEqual(['other']);
    expect(changes).toBe(3);
  });

  it('refuses a second source control with the same id', () => {
    const controls = new SourceControls();
    controls.register(sourceControl('gitlab'));
    expect(() => controls.register(sourceControl('gitlab'))).toThrow(/registered already/);
  });
});
