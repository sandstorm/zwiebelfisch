// Tests for room-versions.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { META_MAP } from './gitlab-protocol';
import { RoomVersions } from './room-versions';

function setup() {
  const ydoc = new Y.Doc();
  const sent: string[] = [];
  const listeners = new Set<(payload: string) => void>();
  const channel = {
    send: (payload: string) => void sent.push(payload),
    listen(listener: (payload: string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const receive = (payload: string) => listeners.forEach((listener) => listener(payload));
  return { ydoc, sent, receive, versions: new RoomVersions(channel) };
}

describe('RoomVersions', () => {
  it('knows a GitLab-backed room by its last commit', () => {
    const { ydoc } = setup();
    expect(RoomVersions.isVersioned(ydoc)).toBe(false);
    ydoc.getMap(META_MAP).set('baseSha', 'abc');
    expect(RoomVersions.isVersioned(ydoc)).toBe(true);
  });

  it('sends save requests and passes on the server’s version messages only', () => {
    const { sent, receive, versions } = setup();
    versions.save('Fix typo', { name: 'Ann' });
    expect(JSON.parse(sent[0])).toEqual({ type: 'gitlab:save', message: 'Fix typo', author: { name: 'Ann' } });
    const received: unknown[] = [];
    versions.onMessage((message) => received.push(message));
    receive('{"type":"gitlab:saved","sha":"s","author":"Ann"}');
    receive('{"type":"other"}');
    receive('not json');
    expect(received).toEqual([{ type: 'gitlab:saved', sha: 's', author: 'Ann' }]);
  });
});
