// @vitest-environment jsdom
// Tests for collaboration-link.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { connect, connectAwareness } from './model/in-process';
import type { PlacedPresence } from './presence/presence';
import { CollaborationLink } from './collaboration-link';
import { Collaboration } from './model/model';
import { Project } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';

const path = ProjectPath.of;

const MAIN = path('/main.typ');
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
  const focused = () => area.contains(document.activeElement);
  const link = new CollaborationLink({ doc: ydoc, awareness }, { project, user: { name: 'Ann' } }, { current: () => ({ path: MAIN, selection: SourceRange.of({ from: 6, to: 11 }) }), focused, onPresence });
  cleanup.push(() => link.dispose(), () => awareness.destroy(), () => area.remove());
  return { ydoc, awareness, link, input, project };
}

const cursor = (awareness: Awareness) => awareness.getLocalState()?.cursor as { path: string } | null | undefined;

describe('CollaborationLink', () => {
  it('shares the project once the collaboration code has loaded', async () => {
    const { ydoc } = setup();
    await vi.waitFor(() => expect(ydoc.getMap<Y.Text>('files').get(MAIN)?.toString()).toBe('Hello world'));
  });

  it('is ready once the project is shared', async () => {
    const { ydoc, link } = setup();
    await link.ready;
    expect(ydoc.getMap<Y.Text>('files').get(MAIN)?.toString()).toBe('Hello world');
  });

  it('publishes the selection the editors report while the user works in the widget', async () => {
    const { ydoc, awareness, input, link } = setup();
    await vi.waitFor(() => expect(ydoc.getMap('files').size).toBe(1));
    link.selectionChanged();
    await Promise.resolve();
    expect(cursor(awareness)).toBeFalsy();
    input.focus();
    link.selectionChanged();
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

  it('stops sharing when disposed before loading finished', async () => {
    const { ydoc, link, project } = setup();
    link.dispose();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const files = ydoc.getMap<Y.Text>('files');
    if (!files.has(MAIN)) files.set(MAIN, new Y.Text('Hello world'));
    files.get(MAIN)!.insert(0, 'Remote: ');
    expect(project.document(MAIN)!.text).toBe('Hello world');
  });

  it("tells the user why the room could not be joined (the server's reason)", async () => {
    vi.spyOn(Collaboration, 'start').mockRejectedValueOnce(new Error('This server opens only GitLab rooms'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    const tell = vi.fn();
    const project = new Project(MAIN, { [MAIN]: 'Hello world' });
    const link = new CollaborationLink({ url: 'ws://127.0.0.1:1234', room: 'plain' }, { project }, { current: () => null, focused: () => false, tell });
    cleanup.push(() => link.dispose());
    await link.ready;
    expect(tell).toHaveBeenCalledWith('Cannot join the room: This server opens only GitLab rooms', 'error');
  });
});
