// Tests for comment-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { SOURCE_EDITOR } from '../../../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../../../hosts/visual-editor/visual-editor';
import type { TextEditor } from '../../../hosts/window/window';
import { commentSearch } from './comment-search';

const MAIN = 'Cold #margin-note[grows][- *Ada* (2026-10-10): Linear?\n- *Grace* (2026-10-11): Yes.] with pages.\n';

function setup(viewType: string) {
  const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': MAIN, '/a.typ': 'A #margin-note[Check this].\n' });
  const document = project.document(ProjectPath.of('/main.typ'))!;
  const open = vi.fn();
  const editNote = vi.fn(() => true);
  const window = { activeTextEditor: { document, viewType } as TextEditor, showDocument: open };
  const search = commentSearch({ project, window }, { editNote });
  return { search, open, editNote, document };
}

describe('commentSearch', () => {
  it('lists the notes of every Typst file by first message, with the authors and the file', async () => {
    const { search } = setup(VISUAL_EDITOR);
    const items = await search.provideItems('', new CancellationTokenSource().token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['Linear?', 'Ada, Grace · main.typ'],
      ['Check this', 'a.typ'],
    ]);
  });

  it("opens the note's file at the note, and its card in the Visual editor", async () => {
    const visual = setup(VISUAL_EDITOR);
    const at = MAIN.indexOf('- *Ada*');
    (await visual.search.provideItems('', new CancellationTokenSource().token))[0].accept();
    expect(visual.open).toHaveBeenCalledWith('/main.typ', { selection: { from: at, to: at } });
    expect(visual.editNote).toHaveBeenCalledWith(visual.document, at);
    const source = setup(SOURCE_EDITOR);
    (await source.search.provideItems('', new CancellationTokenSource().token))[0].accept();
    expect(source.editNote).not.toHaveBeenCalled();
  });
});
