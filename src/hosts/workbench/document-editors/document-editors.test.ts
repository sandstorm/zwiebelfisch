// @vitest-environment jsdom
// Tests for document-editors.ts, shown through the window's custom editors as the workbench does.
import { history, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { type FileChange, Project } from '../../../core/project/project';
import { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';
import { SOURCE_EDITOR, SourceEditorHost } from '../../source-editor/source-editor';
import { VISUAL_EDITOR, VisualEditorHost } from '../../visual-editor/visual-editor';
import { type TextEditorSelectionChangeEvent, WindowHost } from '../../window/window';
import { DocumentEditors } from './document-editors';

// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

const path = ProjectPath.of;

function setup(options: { onSelection?(selection: SourceRange): void } = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const area = host.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': 'Alpha\n', '/b.typ': 'Beta\n', '/logo.png': new Uint8Array([1]) });
  // the Source editors with an undo history (the code-editing extension's basic setup has one)
  const sourceEditors = new SourceEditorHost();
  sourceEditors.registerCodeMirrorExtension({ editor: 'source' }, history());
  const editors = new DocumentEditors(project, { visualEditor: new VisualEditorHost(), sourceEditors, onSelection: (editor) => options.onSelection?.(editor.selection) });
  const window = new WindowHost({
    exists: (at) => project.has(at),
    host,
    statusBar: host.appendChild(document.createElement('div')),
    editingArea: area,
    onDidChangeFile: project.onDidChangeFile,
    activeFile: () => path('/main.typ'),
    onDidChangeActiveFile: new EventEmitter<ProjectPath>().event,
    activeTextEditor: () => editors.activeTextEditor,
    onDidChangeTextEditorSelection: new EventEmitter<TextEditorSelectionChangeEvent>().event,
    menuItems: () => [],
    executeCommand: async () => undefined,
  });
  editors.register(window);
  window.registerCustomEditorProvider('test.image', { resolveCustomEditor() {} }, { displayName: 'Image', filenamePattern: '*.png' });
  const show = (at: string, viewType?: string) => window.showCustomEditor({ path: path(at), content: project.content(path(at))! }, viewType);
  const visible = () => [...area.querySelectorAll<HTMLElement>('.zwf-editor__pane')].filter((pane) => !pane.hidden);
  const change = (fileChange: FileChange) => project.apply(fileChange);
  return { area, editors, window, show, visible, change };
}

describe('DocumentEditors', () => {
  it('keeps the selection when a document switches between the Visual and the Source editor', () => {
    const { editors, show } = setup();
    show('/main.typ');
    show('/main.typ', SOURCE_EDITOR);
    editors.activeTextEditor!.revealRange(SourceRange.of({ from: 1, to: 3 }));
    show('/main.typ', VISUAL_EDITOR);
    expect(editors.activeTextEditor!.selection).toEqual(SourceRange.of({ from: 1, to: 3 }));
    editors.activeTextEditor!.revealRange(SourceRange.of({ from: 4, to: 4 }));
    show('/main.typ', SOURCE_EDITOR);
    expect(editors.activeTextEditor!.selection).toEqual(SourceRange.of({ from: 4, to: 4 }));
  });

  it('makes the edits of `edit` one undo step of the editor shown, in the Visual and in the Source editor', () => {
    const { area, editors, show } = setup();
    const edit = () =>
      editors.activeTextEditor!.edit((builder) => {
        builder.insert(SourceOffset.of(0), '= T\n');
        builder.replace(SourceRange.of({ from: 1, to: 5 }), 'lps');
        builder.delete(SourceRange.of({ from: 5, to: 6 }));
      });
    show('/main.typ');
    const { document } = editors.activeTextEditor!;
    edit();
    expect(document.text).toBe('= T\nAlps');
    (area.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.commands.undo();
    expect(document.text).toBe('Alpha\n');
    show('/main.typ', SOURCE_EDITOR);
    edit();
    expect(document.text).toBe('= T\nAlps');
    undo(EditorView.findFromDOM(area.querySelector<HTMLElement>('[data-testid="zwf-source"]')!)!);
    expect(document.text).toBe('Alpha\n');
  });

  it('registers the Visual editor, then the Source editor, as the editors of *.typ; the Visual editor opens by default', () => {
    const { window, show, visible } = setup();
    expect(window.customEditorChoices(path('/main.typ'))).toEqual([
      { viewType: VISUAL_EDITOR, displayName: 'Visual' },
      { viewType: SOURCE_EDITOR, displayName: 'Source' },
    ]);
    expect(show('/main.typ')).toBe(VISUAL_EDITOR);
    expect(visible()[0].querySelector('.zwf-visual p')?.textContent).toBe('Alpha');
  });

  it("makes a document's view the first time it is shown in it, and keeps it while others are shown", () => {
    const { area, editors, show, visible } = setup();
    show('/main.typ');
    show('/main.typ', SOURCE_EDITOR);
    show('/b.typ');
    expect(area.querySelectorAll('.zwf-editor__pane')).toHaveLength(3);
    expect(visible()).toHaveLength(1);
    expect(visible()[0].querySelector('[data-testid=zwf-source]')?.textContent).toContain('Beta');
    expect(editors.activeTextEditor?.document.text).toBe('Beta\n');
    expect(editors.activeTextEditor?.viewType).toBe(SOURCE_EDITOR);
  });

  it('has an active editor only while one of its editors is shown', () => {
    const { editors, show } = setup();
    show('/main.typ');
    expect(editors.activeTextEditor?.viewType).toBe(VISUAL_EDITOR);
    show('/logo.png');
    expect(editors.activeTextEditor).toBeNull();
  });

  it('reveals in the editor shown', () => {
    const { editors, show, visible } = setup();
    show('/main.typ', SOURCE_EDITOR);
    editors.activeTextEditor!.revealRange(SourceRange.of({ from: 2, to: 3 }));
    expect(editors.activeTextEditor!.selection).toEqual({ from: 2, to: 3 });
    expect(visible()[0].querySelector('[data-testid=zwf-source]')).not.toBeNull();
  });

  it('disposes the editors of a deleted file, and keeps those of a renamed one', () => {
    const { area, show, change } = setup();
    show('/b.typ');
    show('/main.typ');
    change({ kind: 'rename', from: path('/b.typ'), path: path('/c.typ') });
    show('/c.typ');
    expect(area.querySelectorAll('.zwf-editor__pane')).toHaveLength(2);
    show('/main.typ');
    change({ kind: 'delete', path: path('/c.typ') });
    expect(area.querySelectorAll('.zwf-editor__pane')).toHaveLength(1);
    expect(area.textContent).not.toContain('Beta');
  });

  it('reports a moved selection after the editor has it (the collaboration cursor is never one step behind)', () => {
    const seen: SourceRange[] = [];
    const { editors, show } = setup({ onSelection: (selection) => seen.push(selection) });
    show('/main.typ');
    editors.activeTextEditor!.revealRange(SourceRange.of({ from: 1, to: 4 }));
    expect(seen.at(-1)).toEqual({ from: 1, to: 4 });
    show('/main.typ', SOURCE_EDITOR);
    editors.activeTextEditor!.revealRange(SourceRange.of({ from: 0, to: 5 }));
    expect(seen.at(-1)).toEqual({ from: 0, to: 5 });
  });
});

describe('DocumentEditors frame', () => {
  it('puts the frame elements first and last in the visible editor, following editor and document switches', () => {
    const { area, editors, show, visible } = setup();
    const top = document.createElement('nav');
    const bottom = document.createElement('nav');
    editors.setFrame({ top, bottom });
    show('/main.typ');
    const pane = () => visible()[0];
    // Visual: below the toolbar, right before the text; last in the pane
    expect(top.previousElementSibling?.getAttribute('role')).toBe('toolbar');
    expect(top.nextElementSibling?.className).toBe('zwf-visual__body');
    expect(pane().lastElementChild).toBe(bottom);
    show('/main.typ', SOURCE_EDITOR);
    expect(pane().querySelector('.cm-editor')).not.toBeNull();
    expect([pane().firstElementChild, pane().lastElementChild]).toEqual([top, bottom]);
    show('/b.typ');
    expect(pane().contains(top)).toBe(true);
    show('/logo.png');
    expect([top.isConnected, bottom.isConnected]).toEqual([false, false]);
    expect(area.querySelectorAll('nav')).toHaveLength(0);
  });

  it('removes the frame on null', () => {
    const { editors, show } = setup();
    const top = document.createElement('nav');
    const bottom = document.createElement('nav');
    editors.setFrame({ top, bottom });
    show('/main.typ');
    editors.setFrame(null);
    expect([top.isConnected, bottom.isConnected]).toEqual([false, false]);
  });
});
