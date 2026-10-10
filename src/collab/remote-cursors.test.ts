import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Highlight } from '../document/highlight';
import { connect, connectAwareness } from './in-process';
import { RemoteCursors } from './remote-cursors';

const PATH = '/main.typ';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

class FakeView {
  layers: Record<string, readonly Highlight[]> = {};
  setHighlights(layer: string, highlights: readonly Highlight[]) {
    this.layers[layer] = highlights;
  }
}

function client(name: string, ydoc = new Y.Doc()) {
  const awareness = new Awareness(ydoc);
  const text = () => ydoc.getMap<Y.Text>('files').get(PATH);
  const cursors = new RemoteCursors(awareness, { user: { name, color: '#c00' }, text });
  cleanup.push(() => cursors.destroy(), () => awareness.destroy());
  return { ydoc, awareness, cursors };
}

function room(initial: string) {
  const a = client('Ann');
  a.ydoc.getMap<Y.Text>('files').set(PATH, new Y.Text(initial));
  const b = client('Bob');
  connect(a.ydoc, b.ydoc);
  connectAwareness(a.awareness, b.awareness);
  return { a, b, view: new FakeView() };
}

const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const drawn = (view: FakeView) => view.layers['remote-cursors'] ?? [];

describe('RemoteCursors', () => {
  it("draws another user's selection and caret in the views of the same file", async () => {
    const { a, b, view } = room('Hello brave world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 6, to: 11 });
    await settle();
    const [selection, caret] = drawn(view);
    expect(selection).toMatchObject({ from: 6, to: 11, className: 'typst-remote-selection' });
    expect(selection.attributes).toMatchObject({ 'data-user': 'Ann' });
    expect(selection.attributes!.style).toContain('#c00');
    expect(caret).toMatchObject({ from: 11, to: 12, className: 'typst-remote-cursor' });
  });

  it('draws a caret at a line end on the character before it', async () => {
    const { a, b, view } = room('Hello\nworld');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 5, to: 5 });
    await settle();
    expect(drawn(view)).toEqual([expect.objectContaining({ from: 4, to: 5, className: 'typst-remote-cursor typst-remote-cursor--end' })]);
  });

  it('keeps cursors on their characters while the text changes', async () => {
    const { a, b, view } = room('Hello world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 6, to: 6 });
    b.ydoc.getMap<Y.Text>('files').get(PATH)!.insert(0, '>> ');
    await settle();
    expect(drawn(view)).toEqual([expect.objectContaining({ from: 9, to: 10, className: 'typst-remote-cursor' })]);
  });

  it('draws nothing for users in other files, for oneself, or after they leave', async () => {
    const { a, b, view } = room('Hello world');
    const own = new FakeView();
    a.cursors.show(PATH, [own]);
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal('/other.typ', { from: 0, to: 0 });
    await settle();
    expect(drawn(view)).toEqual([]);
    a.cursors.setLocal(PATH, { from: 1, to: 1 });
    await settle();
    expect(drawn(view)).toHaveLength(1);
    expect(drawn(own)).toEqual([]);
    a.cursors.setLocal(null);
    await settle();
    expect(drawn(view)).toEqual([]);
  });

  it('clears the views it no longer shows', async () => {
    const { a, b, view } = room('Hello world');
    b.cursors.show(PATH, [view]);
    a.cursors.setLocal(PATH, { from: 1, to: 1 });
    await settle();
    b.cursors.show(null, []);
    expect(drawn(view)).toEqual([]);
  });
});
