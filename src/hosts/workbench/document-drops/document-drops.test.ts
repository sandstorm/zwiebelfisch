// @vitest-environment jsdom
// Tests for document-drops.ts: a project file dropped on the Visual and on the Source editor, at the drop position, its
// import in the same undo step.
import { undo } from '@codemirror/commands';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceEditorHost } from '../../source-editor/source-editor';
import { VisualEditor, VisualEditorHost } from '../../visual-editor/visual-editor';
import { PROJECT_PATH_TYPE } from '../workbench';
import { type DropEdits, sourceEditorDrops, visualEditorDrops } from './document-drops';

/** A figure of the dropped file's name, and its import at the top; the offsets and files dropped. */
function figureDrops() {
  const dropped: { offset: SourceOffset; file: ProjectPath }[] = [];
  const edits: DropEdits = (_document, offset, file) => {
    dropped.push({ offset, file });
    return file.endsWith('.ic') ? { insertText: '#figure(sheets.Budget)', additionalEdit: [{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '#import "b.typ": sheets\n\n' }] } : null;
  };
  return { edits, dropped };
}

/** A drag event of `type` carrying the project file `path` (a file panel row), as the browser sends it. */
function rowEvent(type: 'dragover' | 'drop', path: string, types = [PROJECT_PATH_TYPE]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [], types, getData: (t: string) => (t === PROJECT_PATH_TYPE ? path : ''), dropEffect: 'none' } });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('visualEditorDrops', () => {
  function setup(text: string, edits: DropEdits) {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument(text);
    const host = new VisualEditorHost();
    host.registerTiptapExtension(({ document }) => visualEditorDrops(document, edits));
    new VisualEditor(parent, doc, host);
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    return { doc, editable, undo: () => parent.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click() };
  }

  it('accepts a project file on dragover, then inserts its edit after the block it was dropped on, the import in the same undo step', () => {
    const { edits, dropped } = figureDrops();
    const { doc, editable, undo } = setup('One\n\nTwo\n', edits);
    const over = rowEvent('dragover', '/data/budget.ic');
    editable.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    // dropped inside "One" (document position 2: after "O"; jsdom has no layout to find it)
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    const drop = rowEvent('drop', '/data/budget.ic');
    editable.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(dropped).toEqual([{ offset: 1, file: '/data/budget.ic' }]);
    expect(doc.text).toBe('#import "b.typ": sheets\n\nOne\n\n#figure(sheets.Budget)\n\nTwo\n');
    undo();
    expect(doc.text).toBe('One\n\nTwo\n');
  });

  it('takes a project file nobody makes something of without inserting anything; leaves other drops to the editor', () => {
    const { edits, dropped } = figureDrops();
    const { doc, editable } = setup('One\n', edits);
    const drop = rowEvent('drop', '/notes.txt');
    editable.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(doc.text).toBe('One\n');
    editable.dispatchEvent(rowEvent('drop', '', ['text/plain']));
    expect(dropped.map(({ file }) => file)).toEqual(['/notes.txt']);
  });
});

describe('sourceEditorDrops', () => {
  function setup(text: string, edits: DropEdits) {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument(text);
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension(({ document }) => sourceEditorDrops(document, edits));
    host.createEditor(parent, doc);
    const view = CodeMirrorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
    return { doc, view };
  }

  it('inserts the edit at the drop position, the import in the same transaction (one undo), the cursor after the insert', () => {
    const { edits, dropped } = figureDrops();
    const { doc, view } = setup('One\n\nTwo\n', edits);
    vi.spyOn(CodeMirrorView.prototype, 'posAtCoords').mockReturnValue(5);
    const drop = rowEvent('drop', '/budget.ic');
    view.contentDOM.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(dropped).toEqual([{ offset: 5, file: '/budget.ic' }]);
    expect(doc.text).toBe('#import "b.typ": sheets\n\nOne\n\n#figure(sheets.Budget)Two\n');
    expect(view.state.selection.main.head).toBe(doc.text.indexOf('Two'));
    undo(view);
    expect(doc.text).toBe('One\n\nTwo\n');
  });
});
