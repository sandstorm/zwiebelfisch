// Tests for scm.ts (ScmHost).
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ScmHost, type SourceControl } from './scm';

const sourceControl = (id: string): SourceControl => ({
  id,
  label: id,
  busy: false,
  onDidChange: () => new Disposable(() => {}),
  commit() {},
});

describe('ScmHost', () => {
  it('lists the registered source controls in order and tells when one comes or goes', () => {
    const controls = new ScmHost();
    let changes = 0;
    controls.onDidChangeSourceControls(() => changes++);
    const gitlab = sourceControl('gitlab');
    const registration = controls.registerSourceControl(gitlab);
    controls.registerSourceControl(sourceControl('other'));
    expect(controls.sourceControls.map((control) => control.id)).toEqual(['gitlab', 'other']);
    registration.dispose();
    registration.dispose();
    expect(controls.sourceControls.map((control) => control.id)).toEqual(['other']);
    expect(changes).toBe(3);
  });

  it('refuses a second source control with the same id', () => {
    const controls = new ScmHost();
    controls.registerSourceControl(sourceControl('gitlab'));
    expect(() => controls.registerSourceControl(sourceControl('gitlab'))).toThrow(/registered already/);
  });
});
