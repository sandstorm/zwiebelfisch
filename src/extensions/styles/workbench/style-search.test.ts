// Tests for style-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { SOURCE_VIEW_TYPE } from '../../../hosts/source-view/source-view';
import { VISUAL_VIEW_TYPE } from '../../../hosts/visual-view/visual-view';
import type { TextEditor } from '../../../hosts/window/window';
import { TypstStyleIndex } from '../model/typst-style-index';
import { styleSearch } from './style-search';

const STYLES = '/// @style inline Keyboard key\n#let key(body) = box(body)\n\n/// @style block Note\n#let note(body) = block(body)\n';

function setup(viewType: string | null, selection = SourceRange.of({ from: 6, to: 11 })) {
  const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': 'Press Enter now.\n', '/styles.typ': STYLES });
  const document = project.document(ProjectPath.of('/main.typ'))!;
  const revealRange = vi.fn();
  const window = {
    activeTextEditor: viewType === null ? null : ({ document, viewType, selection, revealRange } as unknown as TextEditor),
    showInformationMessage: vi.fn(async () => undefined),
  };
  const applier = { apply: vi.fn(() => true) };
  const search = styleSearch(new TypstStyleIndex(project), applier, window);
  const pick = async (label: string) => (await search.provideItems('', new CancellationTokenSource().token)).find((item) => item.label === label)!.accept();
  return { search, document, window, applier, revealRange, pick };
}

describe('styleSearch', () => {
  it('lists the block and inline styles with their kind and file', async () => {
    const items = await setup(SOURCE_VIEW_TYPE).search.provideItems('', new CancellationTokenSource().token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['Keyboard key', 'Inline style · styles.typ'],
      ['Note', 'Block style · styles.typ'],
    ]);
  });

  it('in the Source view wraps the selection in the call, imports the style, and selects the wrapped text', async () => {
    const { document, revealRange, pick } = setup(SOURCE_VIEW_TYPE);
    await pick('Keyboard key');
    expect(document.text).toBe('#import "styles.typ": key\n\nPress #key[Enter] now.\n');
    const [range] = revealRange.mock.calls[0] as [SourceRange];
    expect(document.text.slice(range.from, range.to)).toBe('Enter');
  });

  it("in the Visual view applies it as the view's text style menu does", async () => {
    const { applier, document, pick } = setup(VISUAL_VIEW_TYPE);
    await pick('Note');
    expect(applier.apply).toHaveBeenCalledWith(document, expect.objectContaining({ name: 'note' }));
  });

  it('says why nothing happened without a Typst editor', async () => {
    const { window, pick } = setup(null);
    await pick('Note');
    expect(window.showInformationMessage).toHaveBeenCalled();
  });
});
