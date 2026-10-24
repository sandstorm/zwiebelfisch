// Tests for remote-cursors.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Participant, PlacedPresence } from '../presence/presence';
import { connect, connectAwareness } from './in-process';
import { RemoteCursors } from './remote-cursors';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceRange } from '../../../core/typst-document/typst-document';

const path = ProjectPath.of;

const PATH = path('/main.typ');
const OTHER = path('/chapter.typ');
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function client(name: string, ydoc = new Y.Doc()) {
  const awareness = new Awareness(ydoc);
  const text = (path: string) => ydoc.getMap<Y.Text>('files').get(path);
  const everywhere: (readonly PlacedPresence[])[] = [];
  const participants: (readonly Participant[])[] = [];
  const cursors = new RemoteCursors(awareness, { user: { name, color: '#c00' }, text, onPresence: (all) => everywhere.push(all), onParticipants: (all) => participants.push(all) });
  cleanup.push(() => cursors.dispose(), () => awareness.destroy());
  return { ydoc, awareness, cursors, everywhere, participants };
}

function room(initial: string) {
  const a = client('Ann');
  a.ydoc.getMap<Y.Text>('files').set(PATH, new Y.Text(initial));
  a.ydoc.getMap<Y.Text>('files').set(OTHER, new Y.Text('Chapter two'));
  const b = client('Bob');
  connect(a.ydoc, b.ydoc);
  connectAwareness(a.awareness, b.awareness);
  /** What `b` was told last about the others in PATH. */
  const here = () => (b.everywhere.at(-1) ?? []).filter((presence) => presence.path === PATH);
  return { a, b, here };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('RemoteCursors', () => {
  it("reports another user's selection and caret, with name and color, and their file", async () => {
    const { a, here } = room('Hello brave world');
    a.cursors.setLocal(PATH, SourceRange.of({ from: 6, to: 11 }));
    await settle();
    expect(here()).toEqual([
      { id: String(a.awareness.clientID), user: { name: 'Ann', color: '#c00' }, anchor: 6, head: 11, path: PATH },
    ]);
  });

  it('keeps cursors on their characters while the text changes', async () => {
    const { a, b, here } = room('Hello world');
    a.cursors.setLocal(PATH, SourceRange.of({ from: 6, to: 6 }));
    b.ydoc.getMap<Y.Text>('files').get(PATH)!.insert(0, '>> ');
    await settle();
    expect(here()).toEqual([expect.objectContaining({ anchor: 9, head: 9 })]);
  });

  it('shows a caret on an empty line', async () => {
    const { a, here } = room('Hello\n\nworld');
    a.cursors.setLocal(PATH, SourceRange.of({ from: 6, to: 6 }));
    await settle();
    expect(here()).toEqual([expect.objectContaining({ anchor: 6, head: 6 })]);
  });

  it('reports nobody for oneself, and nobody once they leave', async () => {
    const { a, here } = room('Hello world');
    a.cursors.setLocal(PATH, SourceRange.of({ from: 1, to: 1 }));
    await settle();
    expect(here()).toHaveLength(1);
    expect(a.everywhere.at(-1) ?? []).toEqual([]);
    a.cursors.setLocal(null);
    await settle();
    expect(here()).toEqual([]);
  });

  it('knows whether anybody else is in the room, with a cursor or without', () => {
    const alone = client('Ann');
    expect(alone.cursors.hasOthers).toBe(false);
    const { a, b } = room('Hello');
    b.awareness.setLocalStateField('user', { name: 'Bob' });
    expect(a.cursors.hasOthers).toBe(true);
    b.awareness.setLocalState(null);
    expect(a.cursors.hasOthers).toBe(false);
  });

  it('reports everyone, in any file, once per change', async () => {
    const { a, b } = room('Hello world');
    a.cursors.setLocal(OTHER, SourceRange.of({ from: 8, to: 8 }));
    await settle();
    expect(b.everywhere.at(-1)).toEqual([expect.objectContaining({ path: OTHER, head: 8, user: { name: 'Ann', color: '#c00' } })]);
    const reports = b.everywhere.length;
    b.ydoc.getMap<Y.Text>('files').get(PATH)!.insert(0, 'x');
    await settle();
    expect(b.everywhere).toHaveLength(reports);
    a.cursors.setLocal(null);
    await settle();
    expect(b.everywhere.at(-1)).toEqual([]);
  });

  it('reports who else is in the room, with a cursor or without, once per change', async () => {
    const { a, b } = room('Hello world');
    a.cursors.setLocal(null); // Ann's state reaches Bob
    await settle();
    expect(b.participants.at(-1)).toEqual([{ id: String(a.awareness.clientID), user: { name: 'Ann', color: '#c00' } }]);
    const reports = b.participants.length;
    a.cursors.setLocal(PATH, SourceRange.of({ from: 1, to: 1 }));
    await settle();
    expect(b.participants).toHaveLength(reports);
    a.awareness.setLocalState(null);
    await settle();
    expect(b.participants.at(-1)).toEqual([]);
  });
});
