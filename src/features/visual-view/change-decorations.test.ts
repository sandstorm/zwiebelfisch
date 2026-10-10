// Tests for change-decorations.ts.
import { describe, expect, it } from 'vitest';
import { schema } from './nodes/nodes';
import { changeDecorations, type ChangeKind } from './change-decorations';
import { project } from './projection/projection';

/** The decorations as `[kind, text]`: the decorated text, or the text a deletion widget shows. */
function render(base: string, current: string): [ChangeKind, string][] {
  const doc = project(current, schema);
  return changeDecorations(doc, project(base, schema))
    .find()
    .map((decoration) => {
      const spec = decoration.spec as { change: ChangeKind; text?: string };
      return [spec.change, spec.text ?? doc.textBetween(decoration.from, decoration.to, ' ', (node) => `[${node.type.name}]`)];
    });
}

describe('changeDecorations', () => {
  it('shows nothing when nothing changed', () => {
    expect(render('Same *text*\n', 'Same *text*\n')).toEqual([]);
  });

  it('highlights inserted text', () => {
    expect(render('Hello world\n', 'Hello big world\n')).toEqual([['insert', 'big ']]);
  });

  it('shows deleted text as a widget at the deletion point', () => {
    const doc = project('Hello world\n', schema);
    const [deletion] = changeDecorations(doc, project('Hello big world\n', schema)).find();
    expect(deletion.spec).toMatchObject({ change: 'delete', text: 'big ' });
    expect(deletion.from).toBe(doc.textContent.indexOf('world') + 1);
  });

  it('shows a replaced word as deletion plus insertion', () => {
    expect(render('The color is red\n', 'The colour is red\n')).toEqual([
      ['delete', 'color'],
      ['insert', 'colour'],
    ]);
  });

  it('shows deleted markup by its visible text only', () => {
    expect(render('Keep *this bold* part\n', 'Keep part\n')).toEqual([['delete', 'this bold ']]);
  });

  it('shows a formatting change as one formatting highlight, not as text noise', () => {
    expect(render('Some *bold* text\n', 'Some _bold_ text\n')).toEqual([['format', 'bold']]);
    expect(render('Some bold text\n', 'Some *bold* text\n')).toEqual([['format', 'bold']]);
    expect(render('= Title\n\nText\n', '== Title\n\nText\n')).toEqual([['format', 'Title']]);
  });

  it('marks a raw block whose code changed as a whole', () => {
    expect(render('#let x = 1\n\nText\n', '#let x = 2\n\nText\n')).toEqual([['changed', '[rawBlock]']]);
  });

  it('marks a new paragraph as inserted', () => {
    expect(render('First\n', 'First\n\nSecond\n')).toEqual([['insert', 'Second']]);
  });
});
