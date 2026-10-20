// Tests for window.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Presences } from '../presence/presence';
import { leaveWarning, presenceDecorations } from './window';
import { SourceOffset } from '../../../core/typst-document/typst-document';

describe('presenceDecorations', () => {
  it('decorates a file with the initials of everyone in it, in their colors, and tells when that changes', () => {
    const presences = new Presences(() => undefined);
    const provider = presenceDecorations(presences);
    const changes: unknown[] = [];
    provider.onDidChangeFileDecorations((paths) => changes.push(paths));
    const main = ProjectPath.of('/main.typ');
    presences.set([{ id: '1', user: { name: 'Ann Lee', color: '#b58900' }, anchor: SourceOffset.of(0), head: SourceOffset.of(0), path: main }]);
    expect(changes).toEqual([undefined]);
    expect(provider.provideFileDecoration(main)).toEqual([{ badge: 'AL', tooltip: 'Ann Lee', color: '#b58900', propagate: true }]);
    expect(provider.provideFileDecoration(ProjectPath.of('/a.typ'))).toEqual([]);
  });
});

describe('leaveWarning', () => {
  it('has the browser ask before leaving only while changes would stay uncommitted, until disposed', () => {
    const view = new EventTarget() as Window;
    let uncommitted = false;
    const warning = leaveWarning(view, () => uncommitted);
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      view.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    uncommitted = true;
    expect(leave()).toBe(true);
    warning.dispose();
    expect(leave()).toBe(false);
  });
});
