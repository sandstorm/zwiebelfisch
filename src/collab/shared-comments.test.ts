import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Comments } from '../comments/comments';
import { Project } from '../editor/project';
import { connect } from './in-process';
import { SharedComments } from './shared-comments';
import { SharedProject } from './shared-project';

const MAIN = '/main.typ';
const TEXT = 'Intro. The quick brown fox jumps. Outro.';

let ids = 0;
/** A client; with `peer` it joins that client's room (synced before it starts, as with a server). */
function client(name: string, options: { text?: string; json?: string; peer?: Y.Doc } = {}) {
  const ydoc = new Y.Doc();
  const disconnect = options.peer ? connect(options.peer, ydoc) : () => {};
  const project = new Project(MAIN, options.text === undefined ? {} : { [MAIN]: options.text });
  const shared = new SharedProject(project, ydoc);
  const document = project.document(MAIN)!;
  const comments = new Comments(document, { user: { name }, json: options.json, id: () => `${name}-${ids++}` });
  const sharedComments = new SharedComments(comments, ydoc, () => shared.text(MAIN));
  return { ydoc, document, comments, sharedComments, disconnect };
}

const at = (word: string, text = TEXT) => ({ from: text.indexOf(word), to: text.indexOf(word) + word.length });
const summary = (comments: Comments) =>
  comments.threads().map((t) => ({ quote: t.quote, anchored: t.range !== null, resolved: t.resolved, texts: t.comments.map((c) => `${c.author}: ${c.text}`) }));

describe('SharedComments', () => {
  it('a thread started by one client shows up at the same text for the other', () => {
    const a = client('A', { text: TEXT });
    const b = client('B', { peer: a.ydoc });
    a.comments.add(at('quick'), 'Too fast?');
    expect(summary(b.comments)).toEqual([{ quote: 'quick', anchored: true, resolved: false, texts: ['A: Too fast?'] }]);
    expect(b.comments.threads()[0].range).toEqual(at('quick'));
  });

  it('replies and resolving from both sides merge', () => {
    const a = client('A', { text: TEXT });
    const b = client('B', { peer: a.ydoc });
    const id = a.comments.add(at('brown'), 'Colour?')!;
    b.disconnect();
    a.comments.reply(id, 'Maybe red');
    b.comments.reply(id, 'Keep brown');
    b.comments.setResolved(id, true);
    connect(a.ydoc, b.ydoc);
    expect(summary(a.comments)).toEqual(summary(b.comments));
    expect(summary(a.comments)[0].texts).toHaveLength(3);
    expect(summary(a.comments)[0].resolved).toBe(true);
  });

  it('anchors follow edits from either client, also those made while apart', () => {
    const a = client('A', { text: TEXT });
    const b = client('B', { peer: a.ydoc });
    b.disconnect();
    b.document.change([{ from: 0, to: 0, insert: 'Prologue. ' }], 'test');
    a.comments.add(at('fox'), 'Animal');
    connect(a.ydoc, b.ydoc);
    expect(b.document.text).toBe(a.document.text);
    for (const { comments, document } of [a, b]) {
      expect(comments.threads()[0].range).toEqual(at('fox', document.text));
    }
  });

  it('deleting the commented text orphans the thread for everyone', () => {
    const a = client('A', { text: TEXT });
    const b = client('B', { peer: a.ydoc });
    a.comments.add(at('jumps'), 'Verb');
    b.document.change([at('jumps')].map(({ from, to }) => ({ from, to, insert: '' })), 'test');
    expect(summary(a.comments)[0]).toMatchObject({ quote: 'jumps', anchored: false });
    expect(summary(b.comments)[0]).toMatchObject({ quote: 'jumps', anchored: false });
  });

  it('removing a thread removes it everywhere', () => {
    const a = client('A', { text: TEXT });
    const b = client('B', { peer: a.ydoc });
    const id = a.comments.add(at('Outro'), 'End')!;
    b.comments.remove(id);
    expect(a.comments.threads()).toEqual([]);
  });

  it('the first client seeds the room with its comments; later ones get them', () => {
    const seed = client('Seed', { text: TEXT });
    seed.comments.add(at('Intro'), 'Start');
    const a = client('A', { text: TEXT, json: seed.comments.serialize() });
    const b = client('B', { json: '{"version":1,"threads":[]}', peer: a.ydoc });
    expect(summary(b.comments)).toEqual([{ quote: 'Intro', anchored: true, resolved: false, texts: ['Seed: Start'] }]);
  });
});
