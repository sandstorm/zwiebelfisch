// @vitest-environment jsdom
// Tests that two users' edits in both editors converge (collaboration over in-process Y.Docs).
import { undo as undoSource } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Project } from '../../core/project/project';
import { SourceEditorHost } from '../../hosts/source-editor/source-editor';
import { VisualEditor, VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import { Collaboration } from './model/model';
import { connect, connectAwareness } from './model/in-process';
import { Presences } from './presence/presence';
import { perUserUndo, sourcePresence } from './source-editor/source-editor';
import { visualPresence } from './visual-editor/visual-editor';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';

const path = ProjectPath.of;

const MAIN = path('/main.typ');
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

/**
 * One user's widget, reduced to what collaboration touches: the project, both
 * editing views of the main file (with nothing contributed but this extension's
 * drawing of the others' places and its per-user undo: what the views do not model shows as raw Typst), and the Collaboration
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
  const collaboration = await Collaboration.start({ doc: ydoc, awareness }, { project, user: { name } });
  const presences = new Presences((shown) => project.pathOf(shown));
  collaboration.onDidChangePresence((all) => presences.set(all));
  const visualParent = window.document.createElement('div');
  const sourceParent = window.document.createElement('div');
  window.document.body.append(visualParent, sourceParent);
  const visual = new VisualEditor(visualParent, document, VisualEditorHost.from([visualPresence(presences, () => [document])]));
  const sourceEditors = new SourceEditorHost();
  sourceEditors.registerCodeMirrorExtension(sourcePresence(presences));
  sourceEditors.registerCodeMirrorExtension(perUserUndo);
  const source = sourceEditors.createEditor(sourceParent, document);
  cleanup.push(() => {
    disconnect();
    collaboration.dispose();
    visual.dispose();
    source.dispose();
    awareness.destroy();
  });
  const tiptap = (visualParent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const codemirror = EditorView.findFromDOM(sourceParent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { ydoc, awareness, disconnect, project, document, collaboration, tiptap, codemirror, visualParent, sourceParent };
}

type User = Awaited<ReturnType<typeof user>>;

/** Types `text` in the Visual editor at the end of the paragraph containing `word`. */
function typeVisual(u: User, word: string, text: string) {
  let at = -1;
  u.tiptap.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent.includes(word)) at = pos + node.nodeSize - 1;
  });
  u.tiptap.chain().setTextSelection(at).insertContent(text).run();
}

/** Types `text` in the Source editor at `offset`, as a user edit. */
function typeSource(u: User, offset: number, text: string) {
  u.codemirror.dispatch({ changes: { from: offset, insert: text }, userEvent: 'input.type' });
}

const START = '= Title\n\nFirst paragraph.\n\nSecond paragraph.\n';
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('collaboration', () => {
  it('edits from the Visual and Source editors of two users converge', async () => {
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

  it('a margin note (one edit in two places, as the comments extension makes it) reaches the other user and survives their edits', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    const from = START.indexOf('First');
    const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';
    a.document.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: IMPORT }, { from: SourceOffset.of(from), to: SourceOffset.of(from + 5), insert: '#margin-note[First][]' }], 'test');
    typeSource(a, a.document.text.indexOf('][]') + 2, 'Rename? Ann');
    typeSource(b, b.document.text.indexOf('Second'), 'The ');
    typeVisual(b, 'Second', ' More.');
    for (const u of [a, b]) {
      expect(u.document.text.startsWith(IMPORT)).toBe(true);
      expect(u.document.text).toContain('#margin-note[First][Rename? Ann] paragraph.');
      expect(u.document.text).toContain('The Second paragraph. More.');
    }
    expect(a.document.text).toBe(b.document.text);
  });

  it('undo is per user, in both editors', async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    typeSource(a, a.document.text.indexOf('First'), 'A1 ');
    typeVisual(b, 'Second', ' B1');
    typeVisual(a, 'Second', ' A2');
    typeSource(b, 0, '// B2\n');

    // Ann's Source editor undoes her last edit (A2, made in her Visual editor), not Bob's later B2.
    undoSource(a.codemirror);
    expect(a.document.text).toBe('// B2\n= Title\n\nA1 First paragraph.\n\nSecond paragraph. B1\n');
    // Bob's Visual editor undoes his last Visual edit (B1); Ann's edits stay.
    b.tiptap.commands.undo();
    expect(b.document.text).toBe('// B2\n= Title\n\nA1 First paragraph.\n\nSecond paragraph.\n');
    undoSource(a.codemirror);
    expect(a.document.text).toBe('// B2\n= Title\n\nFirst paragraph.\n\nSecond paragraph.\n');
    expect(a.document.text).toBe(b.document.text);
  });

  it("shows the other user's cursor in both editors", async () => {
    const a = await user('Ann', { [MAIN]: START });
    const b = await user('Bob', {}, a);
    const from = START.indexOf('paragraph');
    a.collaboration.setCursor(MAIN, SourceRange.of({ from: from, to: from + 9 }));
    await settle();
    for (const parent of [b.visualParent, b.sourceParent]) {
      const selection = [...parent.querySelectorAll('.typst-collaboration__selection')].map((e) => e.textContent).join('');
      expect(selection).toBe('paragraph');
      expect(parent.querySelector('.typst-collaboration__selection')?.getAttribute('data-user')).toBe('Ann');
    }
    expect(a.visualParent.querySelector('.typst-collaboration__selection')).toBeNull();
  });
});
