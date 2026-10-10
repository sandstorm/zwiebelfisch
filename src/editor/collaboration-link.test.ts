// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Comments } from '../comments/comments';
import { CollaborationLink } from './collaboration-link';
import { Project } from './project';

const MAIN = '/main.typ';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function setup() {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const project = new Project(MAIN, { [MAIN]: 'Hello world' });
  const comments = new Comments(project.document(MAIN)!);
  const area = document.createElement('div');
  const input = document.createElement('textarea');
  area.append(input);
  document.body.append(area);
  const view = { selection: () => ({ from: 6, to: 11 }) };
  const link = new CollaborationLink({ doc: ydoc, awareness }, { project, comments, user: { name: 'Ann' } }, area, () => ({ path: MAIN, view }));
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
