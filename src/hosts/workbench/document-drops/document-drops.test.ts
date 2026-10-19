// @vitest-environment jsdom
// Tests for document-drops.ts: a project file, or files from the computer once uploaded, dropped on the Visual and on
// the Source editor, at the drop position, their imports in the same undo step.
import { history, undo } from '@codemirror/commands';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceEditorHost } from '../../source-editor/source-editor';
import { VisualEditor, VisualEditorHost } from '../../visual-editor/visual-editor';
import { PROJECT_PATH_TYPE } from '../workbench';
import { type DocumentDrops, sourceEditorDrops, visualEditorDrops } from './document-drops';

/**
 * A figure for a dropped spreadsheet, and its import at the top; an uploaded file is at the top of the project. The
 * offsets and files dropped.
 */
function figureDrops() {
  const dropped: { offset: SourceOffset; file: ProjectPath }[] = [];
  const drops: DocumentDrops = {
    edit: (_document, offset, file) => {
      dropped.push({ offset, file });
      return file.endsWith('.ic') ? { insertText: '#figure(sheets.Budget)', additionalEdit: [{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '#import "b.typ": sheets\n\n' }] } : null;
    },
    upload: async (_document, files) => files.map((file) => ProjectPath.of(`/${file.name}`)),
  };
  return { drops, dropped };
}

/** A drag event of `type` carrying the project file `path` (a file panel row), as the browser sends it. */
function rowEvent(type: 'dragover' | 'drop', path: string, types = [PROJECT_PATH_TYPE]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [], types, getData: (t: string) => (t === PROJECT_PATH_TYPE ? path : ''), dropEffect: 'none' } });
  return event;
}

/** A drag event of `type` carrying files from the computer, as the browser sends it. */
function filesEvent(type: 'dragover' | 'drop', files: File[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'], getData: () => '', dropEffect: 'none' } });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('visualEditorDrops', () => {
  function setup(text: string, drops: DocumentDrops) {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument(text);
    const host = new VisualEditorHost();
    host.registerTiptapExtension(({ document }) => visualEditorDrops(document, drops));
    new VisualEditor(parent, doc, host);
    const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
    return { doc, editable, undo: () => parent.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click() };
  }

  it('accepts a project file on dragover, then inserts its edit after the block it was dropped on, the import in the same undo step', () => {
    const { drops, dropped } = figureDrops();
    const { doc, editable, undo } = setup('One\n\nTwo\n', drops);
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
    const { drops, dropped } = figureDrops();
    const { doc, editable } = setup('One\n', drops);
    const drop = rowEvent('drop', '/notes.txt');
    editable.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(doc.text).toBe('One\n');
    editable.dispatchEvent(rowEvent('drop', '', ['text/plain']));
    expect(dropped.map(({ file }) => file)).toEqual(['/notes.txt']);
  });

  it('accepts files from the computer, and inserts the edits of the uploaded ones there, in order', async () => {
    const { drops, dropped } = figureDrops();
    const { doc, editable } = setup('One\n\nTwo\n', drops);
    const over = filesEvent('dragover', []);
    editable.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    const outside: Event[] = [];
    document.body.addEventListener('drop', (event) => outside.push(event));
    const drop = filesEvent('drop', [new File([''], 'notes.txt'), new File([''], 'budget.ic')]);
    editable.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(outside).toEqual([]);
    await vi.waitFor(() => expect(doc.text).toBe('#import "b.typ": sheets\n\nOne\n\n#figure(sheets.Budget)\n\nTwo\n'));
    expect(dropped).toEqual([{ offset: 1, file: '/notes.txt' }, { offset: 1, file: '/budget.ic' }]);
  });
});

describe('sourceEditorDrops', () => {
  function setup(text: string, drops: DocumentDrops) {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument(text);
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension(history());
    host.registerCodeMirrorExtension(({ document }) => sourceEditorDrops(document, drops));
    host.createEditor(parent, doc);
    const view = CodeMirrorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
    return { doc, view };
  }

  it('inserts the edit at the drop position, the import in the same transaction (one undo), the cursor after the insert', () => {
    const { drops, dropped } = figureDrops();
    const { doc, view } = setup('One\n\nTwo\n', drops);
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

  it('inserts the edits of uploaded files from the computer at the drop position, one after the other', async () => {
    const { drops } = figureDrops();
    const { doc, view } = setup('One\n\nTwo\n', drops);
    vi.spyOn(CodeMirrorView.prototype, 'posAtCoords').mockReturnValue(5);
    const drop = filesEvent('drop', [new File([''], 'a.ic'), new File([''], 'b.ic')]);
    view.contentDOM.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(doc.text).toBe('#import "b.typ": sheets\n\n#import "b.typ": sheets\n\nOne\n\n#figure(sheets.Budget)#figure(sheets.Budget)Two\n'));
  });
});
