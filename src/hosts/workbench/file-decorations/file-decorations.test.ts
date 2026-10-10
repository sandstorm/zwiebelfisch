// Tests for file-decorations.ts.
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileDecoration, FileDecorationProvider } from '../workbench';
import { FileDecorations } from './file-decorations';

const path = ProjectPath.of;

function provider(decorations: Record<string, FileDecoration | FileDecoration[]>) {
  const changed = new EventEmitter<readonly ProjectPath[] | undefined>();
  const provider: FileDecorationProvider = {
    provideFileDecoration: (file) => decorations[file],
    onDidChangeFileDecorations: changed.event,
  };
  return { provider, changed };
}

describe('FileDecorations', () => {
  it("gives a file every provider's decorations, in registration order, until a provider is disposed", () => {
    const decorations = new FileDecorations();
    const first = provider({ '/a.typ': { badge: 'A' } });
    const second = provider({ '/a.typ': [{ badge: 'B' }, { badge: 'C' }], '/b.typ': { badge: 'D' } });
    decorations.register(first.provider);
    const registration = decorations.register(second.provider);
    expect(decorations.decorationsOf(path('/a.typ')).map((d) => d.badge)).toEqual(['A', 'B', 'C']);
    expect(decorations.decorationsOf(path('/c.typ'))).toEqual([]);
    registration.dispose();
    expect(decorations.decorationsOf(path('/b.typ'))).toEqual([]);
  });

  it('tells when decorations change: a provider says so, or one comes or goes', () => {
    const decorations = new FileDecorations();
    const changes: (readonly ProjectPath[] | undefined)[] = [];
    decorations.onDidChange((paths) => changes.push(paths));
    const { provider: registered, changed } = provider({});
    const registration = decorations.register(registered);
    changed.fire([path('/a.typ')]);
    registration.dispose();
    changed.fire(undefined);
    expect(changes).toEqual([undefined, [path('/a.typ')], undefined]);
  });
});
