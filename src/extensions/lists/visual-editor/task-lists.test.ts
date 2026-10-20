// @vitest-environment jsdom
// Tests for task lists (task-lists.ts): their conversion and the checklist preamble an added task item brings along.
import { describe, expect, it } from 'vitest';
import { CHECKLIST_PREAMBLE } from '../model/checklist-preamble';
import { serializeToTypst } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { after, createEditor, edit, expectPreciseMap, find, parseTypst, schema } from '../../../testing/testing';

const PREAMBLE = '#import "@preview/cheq:0.4.0": checklist\n#show: checklist';

const FIXTURES: Record<string, string> = {
  tasks: `${PREAMBLE}\n\n- [ ] todo\n- [x] done *well*\n- plain\n- [ ]\n`,
  notTasks: '- [X] upper\n- [/] other\n- [ ]no space\n+ [ ] enum\n- [ ] nested\n\n  more\n',
  mixed: '- [ ] a\n- b\n- [x] c\n',
};

describe('task lists', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        expect(serializeToTypst(parseTypst(source))).toBe(source);
        expectPreciseMap(parseTypst(source));
      });
    }
  });

  it('parses "- [ ] " and "- [x] " items as task items, the box hidden', () => {
    const doc = parseTypst(FIXTURES.tasks);
    const list = doc.child(1);
    expect(list.type.name).toBe('taskList');
    expect(list.childCount).toBe(2);
    expect(list.child(0).attrs.checked).toBe(false);
    expect(list.child(0).textContent).toBe('todo');
    expect(list.child(1).attrs.checked).toBe(true);
    expect(list.child(1).textContent).toBe('done well');
    expect(doc.child(2).type.name).toBe('bulletList');
    expect(doc.child(3).type.name).toBe('taskList');
    expect(doc.child(3).child(0).content.size).toBe(2);
  });

  it('keeps other boxes, enum items and nested bodies as they are', () => {
    const doc = parseTypst(FIXTURES.notTasks);
    expect(doc.child(0).type.name).toBe('bulletList');
    expect(doc.child(0).child(0).textContent).toBe('[X] upper');
    expect(doc.child(1).type.name).toBe('orderedList');
    expect(doc.child(2).type.name).toBe('bulletList');
    expect(doc.child(2).child(0).child(0).type.name).toBe('rawBlock');
  });

  it('splits a mixed list into task lists and bullet lists', () => {
    const doc = parseTypst(FIXTURES.mixed);
    expect([0, 1, 2].map((i) => doc.child(i).type.name)).toEqual(['taskList', 'bulletList', 'taskList']);
  });

  it('checking a box changes just the [ ] in the source', () => {
    const doc = edit(parseTypst(FIXTURES.tasks), (s) => {
      const { node, pos } = find(s.doc, 'taskItem');
      return s.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true });
    });
    expect(serializeToTypst(doc)).toBe(FIXTURES.tasks.replace('- [ ] todo', '- [x] todo'));
    expectPreciseMap(doc);
  });

  it('typing in a task keeps its box', () => {
    const doc = edit(parseTypst(FIXTURES.mixed), (s) => s.tr.insertText('!', after(s.doc, 'c')));
    expect(serializeToTypst(doc)).toBe('- [ ] a\n- b\n- [x] c!\n');
  });

  it('prints task items created in the editor', () => {
    const doc = edit(parseTypst('Text\n'), (s) => {
      const item = (checked: boolean, text: string) =>
        schema.nodes.taskItem.create({ checked }, schema.nodes.paragraph.create(null, schema.text(text)));
      return s.tr.insert(s.doc.content.size, schema.nodes.taskList.create(null, [item(false, '[a]'), item(true, 'b')]));
    });
    expect(serializeToTypst(doc)).toBe('Text\n\n- [ ] \\[a\\]\n- [x] b\n');
    expectPreciseMap(doc);
  });
});

describe('the checklist preamble', () => {
  /** `source` after an edit in the editor that appends the task item "new" (or, with `fromSource`, a change from the source). */
  const addTask = (source: string, { fromSource = false } = {}) => {
    const editor = createEditor(source);
    const { state } = editor;
    const task = state.schema.nodes.taskItem.create({ checked: false }, state.schema.nodes.paragraph.create(null, state.schema.text('new')));
    const tr = state.tr.insert(state.doc.content.size, state.schema.nodes.taskList.create(null, task));
    if (fromSource) tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
    return serializeToTypst(editor.state.doc);
  };

  it('an added task item brings the import and the show rule, at the top', () => {
    expect(CHECKLIST_PREAMBLE).toBe(PREAMBLE);
    expect(addTask('= Title\n')).toBe(`${PREAMBLE}\n\n= Title\n\n- [ ] new\n`);
  });

  it('adds nothing when both are there, in any form', () => {
    for (const source of [`${PREAMBLE}\n\nText\n`, '#set page(width: 10cm)\n#import "@preview/cheq:0.3.1": *\n\n#show: checklist.with(fill: luma(95%))\n\nText\n']) {
      expect(addTask(source)).toBe(`${source}\n- [ ] new\n`);
    }
  });

  it('adds only the show rule, right after an existing import', () => {
    const source = '#import "@preview/cheq:0.4.0": checklist\n\n= Title\n';
    expect(addTask(source)).toBe('#import "@preview/cheq:0.4.0": checklist\n\n#show: checklist\n\n= Title\n\n- [ ] new\n');
  });

  it('adds only the import when the show rule is there', () => {
    expect(addTask('#show: checklist\n\nText\n')).toBe('#import "@preview/cheq:0.4.0": checklist\n\n#show: checklist\n\nText\n\n- [ ] new\n');
  });

  it('leaves task items that come from the source alone', () => {
    expect(addTask('Text\n', { fromSource: true })).toBe('Text\n\n- [ ] new\n');
  });
});
