// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { connect, connectAwareness } from '../collab/in-process';
import type { PlacedPresence } from '../document/presence';
import { CollaborationLink } from './collaboration-link';
import { Project } from './project';

const MAIN = '/main.typ';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function setup(onPresence?: (presences: readonly PlacedPresence[]) => void) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const project = new Project(MAIN, { [MAIN]: 'Hello world' });
  const area = document.createElement('div');
  const input = document.createElement('textarea');
  area.append(input);
  document.body.append(area);
  const view = { selection: () => ({ from: 6, to: 11 }) };
  const link = new CollaborationLink({ doc: ydoc, awareness }, { project, user: { name: 'Ann' } }, area, { current: () => ({ path: MAIN, view }), onPresence });
  cleanup.push(() => link.destroy(), () => awareness.destroy(), () => area.remove());
  return { ydoc, awareness, link, input, project };
}

const cursor = (awareness: Awareness) => awareness.getLocalState()?.cursor as { path: string } | null | undefined;

describe('CollaborationLink', () => {
  it('shares the project once the collaboration code has loaded', async () => {
    const { ydoc } = setup();
    await vi.waitFor(() => expect(ydoc.getMap<Y.Text>('files').get(MAIN)?.toString()).toBe('Hello world'));
  });

  it('publishes the selection when it changes while the user works in the widget', async () => {
    const { ydoc, awareness, input } = setup();
    await vi.waitFor(() => expect(ydoc.getMap('files').size).toBe(1));
    document.dispatchEvent(new Event('selectionchange'));
    await Promise.resolve();
    expect(cursor(awareness)).toBeFalsy();
    input.focus();
    document.dispatchEvent(new Event('selectionchange'));
    await vi.waitFor(() => expect(cursor(awareness)).toMatchObject({ path: MAIN }));
  });

  it("tells the widget where the other users are", async () => {
    const onPresence = vi.fn();
    const { ydoc, awareness } = setup(onPresence);
    await vi.waitFor(() => expect(ydoc.getMap('files').size).toBe(1));
    const other = new Y.Doc();
    const otherAwareness = new Awareness(other);
    cleanup.push(connect(ydoc, other), () => otherAwareness.destroy());
    connectAwareness(awareness, otherAwareness);
    otherAwareness.setLocalStateField('user', { name: 'Bob', color: '#000080' });
    const text = other.getMap<Y.Text>('files').get(MAIN)!;
    const position = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 6));
    otherAwareness.setLocalStateField('cursor', { path: MAIN, anchor: position, head: position });
    await vi.waitFor(() =>
      expect(onPresence).toHaveBeenLastCalledWith([expect.objectContaining({ path: MAIN, head: 6, user: { name: 'Bob', color: '#000080' } })]),
    );
  });

  it('stops sharing when destroyed before loading finished', async () => {
    const { ydoc, link, project } = setup();
    link.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const files = ydoc.getMap<Y.Text>('files');
    if (!files.has(MAIN)) files.set(MAIN, new Y.Text('Hello world'));
    files.get(MAIN)!.insert(0, 'Remote: ');
    expect(project.document(MAIN)!.text).toBe('Hello world');
  });
});
