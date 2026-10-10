// Tests for remote-cursors.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { PlacedPresence, Presence } from '../../../core/typst-document/typst-document';
import { connect, connectAwareness } from './in-process';
import { RemoteCursors } from './remote-cursors';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const PATH = path('/main.typ');
const OTHER = path('/chapter.typ');
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

class FakeView {
  presences: readonly Presence[] = [];
  setPresence(presences: readonly Presence[]) {
    this.presences = presences;
  }
}

function client(name: string, ydoc = new Y.Doc()) {
  const awareness = new Awareness(ydoc);
  const text = (path: string) => ydoc.getMap<Y.Text>('files').get(path);
  const everywhere: (readonly PlacedPresence[])[] = [];
  const cursors = new RemoteCursors(awareness, { user: { name, color: '#c00' }, text, onPresence: (all) => everywhere.push(all) });
  cleanup.push(() => cursors.destroy(), () => awareness.destroy());
  return { ydoc, awareness, cursors, everywhere };
}

function room(initial: string) {
  const a = client('Ann');
  a.ydoc.getMap<Y.Text>('files').set(PATH, new Y.Text(initial));
  a.ydoc.getMap<Y.Text>('files').set(OTHER, new Y.Text('Chapter two'));
  const b = client('Bob');
  connect(a.ydoc, b.ydoc);
  connectAwareness(a.awareness, b.awareness);
  return { a, b, view: new FakeView() };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('RemoteCursors', () => {
  it("shows another user's selection and caret, with name and color, in the views of the same file", async () => {
    const { a, b, view } = room('Hello brave world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 6, to: 11 });
    await settle();
    expect(view.presences).toEqual([
      { id: String(a.awareness.clientID), user: { name: 'Ann', color: '#c00' }, anchor: 6, head: 11, path: PATH },
    ]);
  });

  it('keeps cursors on their characters while the text changes', async () => {
    const { a, b, view } = room('Hello world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 6, to: 6 });
    b.ydoc.getMap<Y.Text>('files').get(PATH)!.insert(0, '>> ');
    await settle();
    expect(view.presences).toEqual([expect.objectContaining({ anchor: 9, head: 9 })]);
  });

  it('shows a caret on an empty line', async () => {
    const { a, b, view } = room('Hello\n\nworld');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 6, to: 6 });
    await settle();
    expect(view.presences).toEqual([expect.objectContaining({ anchor: 6, head: 6 })]);
  });

  it('shows nothing for users in other files, for oneself, or after they leave', async () => {
    const { a, b, view } = room('Hello world');
    const own = new FakeView();
    a.cursors.show(PATH, [own]);
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(OTHER, { from: 0, to: 0 });
    await settle();
    expect(view.presences).toEqual([]);
    a.cursors.setLocal(PATH, { from: 1, to: 1 });
    await settle();
    expect(view.presences).toHaveLength(1);
    expect(own.presences).toEqual([]);
    a.cursors.setLocal(null);
    await settle();
    expect(view.presences).toEqual([]);
  });

  it('reports everyone, in any file, once per change', async () => {
    const { a, b } = room('Hello world');
    b.cursors.show(PATH, [new FakeView()]);
    a.cursors.setLocal(OTHER, { from: 8, to: 8 });
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

  it('clears the views it no longer shows', async () => {
    const { a, b, view } = room('Hello world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 1, to: 1 });
    await settle();
    b.cursors.show(null, []);
    expect(view.presences).toEqual([]);
  });
});
