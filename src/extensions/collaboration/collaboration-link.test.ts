// @vitest-environment jsdom
// Tests for collaboration-link.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { connect, connectAwareness } from './model/in-process';
import type { PlacedPresence } from './presence/presence';
import { Account } from './account';
import { CollaborationLink } from './collaboration-link';
import { Collaboration } from './model/model';
import { Project } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { SIGN_IN_REQUIRED } from '../../core/room-protocol/room-protocol';

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

  describe('with a server: the account', () => {
    const SERVER = { url: 'ws://127.0.0.1:1234', room: 'r1' };
    const account = (me: object | null) =>
      new Account(SERVER.url, async () => (me ? new Response(JSON.stringify(me)) : new Response('Not signed in', { status: 401 })));
    const join = (a: Account) => {
      const widget = { current: () => null, focused: () => false, tell: vi.fn(), signInRequired: vi.fn() };
      const link = new CollaborationLink(SERVER, { project: new Project(MAIN, { [MAIN]: 'Hello' }), user: { name: 'Local', color: '#123456' } }, widget, a);
      cleanup.push(() => link.dispose());
      return { link, widget };
    };

    it('signed out: asks the widget to offer signing in, and does not connect', async () => {
      const start = vi.spyOn(Collaboration, 'start');
      const { link, widget } = join(account(null));
      await link.ready;
      expect(widget.signInRequired).toHaveBeenCalledOnce();
      expect(widget.tell).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    });

    it('signed in: joins as the signed-in user (the name the server knows, the host’s color)', async () => {
      const start = vi.spyOn(Collaboration, 'start').mockRejectedValueOnce(new Error('stop here'));
      vi.spyOn(console, 'error').mockImplementationOnce(() => {});
      const { link } = join(account({ provider: 'gitlab', id: '2', name: 'Ann' }));
      await link.ready;
      expect(start.mock.calls[0][1].user).toEqual({ name: 'Ann', color: '#123456' });
    });

    it('refused for not being signed in (the session ended meanwhile): asks to sign in, too', async () => {
      vi.spyOn(Collaboration, 'start').mockRejectedValueOnce(new Error(SIGN_IN_REQUIRED));
      const { link, widget } = join(account({ provider: 'gitlab', id: '2', name: 'Ann' }));
      await link.ready;
      expect(widget.signInRequired).toHaveBeenCalledOnce();
      expect(widget.tell).not.toHaveBeenCalled();
    });
  });
});
