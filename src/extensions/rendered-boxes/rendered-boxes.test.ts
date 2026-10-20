// Tests for rendered-boxes.ts: where the extension gets a document's snippets.
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { renderedBoxes } from './rendered-boxes';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';

const path = ProjectPath.of;

describe('renderedBoxes', () => {
  it('asks the preview for snippets of the document under its current path', async () => {
    const project = new Project(path('/main.typ'), { '/main.typ': '= Hi\n', '/chapters/one.typ': '$x$\n' });
    const preview = { snippet: vi.fn(async () => ({ svg: '<svg/>', width: 1, height: 1, textHeight: 1, padding: 0 })), onDidRender: vi.fn(() => new Disposable(() => {})) };
    const visualEditor = new VisualEditorHost();
    const window = { registerStyleSheet: () => new Disposable(() => {}) };
    renderedBoxes().activate({ project, preview, visualEditor, window, subscriptions: [] } as unknown as ExtensionContext);
    const document = project.document(path('/chapters/one.typ'))!;
    const renderer = visualEditor.contributed().rawBoxRenderers[0]({ document, selection: () => SourceRange.of({ from: 0, to: 0 }), isBox: () => false })!;
    const box = { attrs: { src: '$x$' }, isInline: false } as unknown as Node;
    await renderer.render(box, SourceOffset.of(0));
    expect(preview.snippet).toHaveBeenCalledWith(path('/chapters/one.typ'), { from: 0, to: 3 }, '$x$');
    project.apply({ kind: 'rename', from: path('/chapters/one.typ'), path: path('/chapters/first.typ') });
    await renderer.render(box, SourceOffset.of(0));
    expect(preview.snippet).toHaveBeenLastCalledWith(path('/chapters/first.typ'), { from: 0, to: 3 }, '$x$');
  });
});
