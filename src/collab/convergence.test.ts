// @vitest-environment jsdom
import '../visual-view/jsdom-setup';
import { undo as undoSource } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Comments } from '../comments/comments';
import { Project } from '../editor/project';
import { SourceView } from '../source-view/source-view';
import { VisualView } from '../visual-view/visual-view';
import { Collaboration } from './collaboration';
import { connect, connectAwareness } from './in-process';

const MAIN = '/main.typ';
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

/**
 * One user's widget, reduced to what collaboration touches: the project, both
 * editing views of the main file, the comments, and the Collaboration
 * joining the room `peer` is in (already synced, as with a server).
 */
async function user(name: string, files: Record<string, string>, peer?: { ydoc: Y.Doc; awareness: Awareness }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  let disconnect = () => {};
  if (peer) {
    disconnect = connect(peer.ydoc, ydoc);
    connectAwareness(peer.awareness, awareness);
  }
  const project = new Project(MAIN, files);
  const document = project.document(MAIN)!;
  const comments = new Comments(document, { user: { name } });
  const collaboration = await Collaboration.start({ doc: ydoc, awareness }, { project, comments, user: { name } });
  const visualParent = window.document.createElement('div');
  const sourceParent = window.document.createElement('div');
  window.document.body.append(visualParent, sourceParent);
  const visual = new VisualView(visualParent, document);
  const source = new SourceView(sourceParent, document);
  collaboration.showCursors(MAIN, [visual, source]);
  cleanup.push(() => {
    disconnect();
    collaboration.destroy();
    visual.destroy();
    source.destroy();
    awareness.destroy();
  });
  const tiptap = (visualParent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const codemirror = EditorView.findFromDOM(sourceParent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { ydoc, awareness, disconnect, project, document, comments, collaboration, tiptap, codemirror, visualParent, sourceParent };
}

type User = Awaited<ReturnType<typeof user>>;

/** Types `text` in the Visual view at the end of the paragraph containing `word`. */
function typeVisual(u: User, word: string, text: string) {
  let at = -1;
  u.tiptap.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent.includes(word)) at = pos + node.nodeSize - 1;
  });
  u.tiptap.chain().setTextSelection(at).insertContent(text).run();
}

/** Types `text` in the Source view at `offset`, as a user edit. */
function typeSource(u: User, offset: number, text: string) {
  u.codemirror.dispatch({ changes: { from: offset, insert: text }, userEvent: 'input.type' });
}

const START = '= Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('collaboration', () => {
  it('edits from the Visual and Source views of two users converge', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    expect(b.document.text).toBe(START);

    typeVisual(a, 'First', ' Ann was here.');
    typeSource(b, b.document.text.indexOf('Second'), 'The ');
    typeVisual(b, 'Second', ' Bob too.');
    typeSource(a, 0, '#set page(width: 10cm)\n');

    const expected = '#set page(width: 10cm)\n= Title\n\nFirst paragraph. Ann was here.\n\nThe Second paragraph. Bob too.\n';
    for (const u of [a, b]) {
      expect(u.document.text).toBe(expected);
      expect(u.codemirror.state.doc.toString()).toBe(expected);
      expect(u.visualParent.textContent).toContain('First paragraph. Ann was here.');
      expect(u.visualParent.textContent).toContain('The Second paragraph. Bob too.');
    }
  });

  it('concurrent edits made while apart converge once reconnected', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    b.disconnect();
    typeVisual(a, 'First', ' (A)');
    typeVisual(b, 'First', ' (B)');
    typeSource(b, 0, '// B\n');
    connect(a.ydoc, b.ydoc);
    expect(a.document.text).toBe(b.document.text);
    expect(a.document.text).toMatch(/^\/\/ B\n= Title\n\nFirst paragraph\. \((A\) \(B|B\) \(A)\)\n/);
    expect(a.tiptap.state.doc.textContent).toBe(b.tiptap.state.doc.textContent);
  });

  it('review comments survive edits by the other user', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    const from = START.indexOf('Second');
    const id = a.comments.add({ from, to: from + 6 }, 'Rename?')!;
    typeSource(b, 0, '#set text(size: 11pt)\n');
    typeVisual(b, 'Second', ' More.');
    b.comments.reply(id, 'Fine as is');
    for (const u of [a, b]) {
      const [thread] = u.comments.threads();
      expect(thread.quote).toBe('Second');
      expect(u.document.text.slice(thread.range!.from, thread.range!.to)).toBe('Second');
      expect(thread.comments.map((c) => c.author)).toEqual(['Ann', 'Bob']);
    }
  });

  it('undo is per user, in both views', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    typeSource(a, a.document.text.indexOf('First'), 'A1 ');
    typeVisual(b, 'Second', ' B1');
    typeVisual(a, 'Second', ' A2');
    typeSource(b, 0, '// B2\n');

    // Ann's Source view undoes her last edit (A2, made in her Visual view), not Bob's later B2.
    undoSource(a.codemirror);
    expect(a.document.text).toBe('// B2\n= Title\n\nA1 First paragraph.\n\nSecond paragraph. B1\n');
    // Bob's Visual view undoes his last Visual edit (B1); Ann's edits stay.
    b.tiptap.commands.undo();
    expect(b.document.text).toBe('// B2\n= Title\n\nA1 First paragraph.\n\nSecond paragraph.\n');
    undoSource(a.codemirror);
    expect(a.document.text).toBe('// B2\n= Title\n\nFirst paragraph.\n\nSecond paragraph.\n');
    expect(a.document.text).toBe(b.document.text);
  });

  it("shows the other user's cursor in both views", async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    const from = START.indexOf('paragraph');
    a.collaboration.setCursor(MAIN, { from, to: from + 9 });
    await settle();
    for (const parent of [b.visualParent, b.sourceParent]) {
      const selection = [...parent.querySelectorAll('.typst-remote-selection')].map((e) => e.textContent).join('');
      expect(selection).toBe('paragraph');
      expect(parent.querySelector('.typst-remote-selection')?.getAttribute('data-user')).toBe('Ann');
    }
    expect(a.visualParent.querySelector('.typst-remote-selection')).toBeNull();
  });
});
