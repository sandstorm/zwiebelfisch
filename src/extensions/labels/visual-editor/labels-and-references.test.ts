// Tests for visual-editor.ts and the Typst ↔ ProseMirror conversion: references (`@key`) as chips, labels (`<key>`) as attributes of the blocks they label.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { after, edit, expectPreciseMap, find, schemaWith, TestPrompts } from '../../../testing/testing';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { LabelIndex } from '../model/label-index';
import { serializeToTypst, parseTypst as parseTypstWith, applyTypstChanges } from '../../../hosts/visual-editor/visual-editor';
import { references as referencesContribution } from './visual-editor';

const noLabels = new LabelIndex(new Project(ProjectPath.of('/main.typ'), { '/main.typ': '' }));
const schema = schemaWith({ contributions: [referencesContribution({ labels: noLabels, prompts: new TestPrompts() })] });
const parseTypst = (source: string): Node => parseTypstWith(source, schema);

const chapter = (name: string) => readFileSync(new URL(`../../../../demo/examples/advanced/chapters/${name}.typ`, import.meta.url), 'utf8');

const FIXTURES: Record<string, string> = {
  introduction: chapter('introduction'),
  method: chapter('method'),
  results: chapter('results'),
  refs: 'See @method, @results and @fig:compile-times.\n\nAs in @key[Chapter] and @eq:speedup: done.\n',
  punctuation: 'End @fig:x. Then @a:b: and (@c) @d\'s @e, @f!\n',
  refsEverywhere:
    '= About @intro\n\n- item @intro\n+ step @fig:x\n\n#table(columns: 2, [@a], [see @b.])\n\n' +
    '#figure(image("a.png"), caption: [As in @intro]) <fig:a>\n\n*bold @x* and more\n',
  headingLabels: '= Introduction <intro>\n\n== Tight<tight>\n\n= Next line\n<next>\n\nText\n',
  figureLabels: '#figure(image("a.png"), caption: [A]) <fig:a>\n\n#figure(\n  image("b.png"),\n)\n<fig:b>\n\n#figure(image("c.png"))<c>\n',
  equationLabels: '$ s(p) = 1 $ <eq:speedup>\n\n$ x $<eq:x>\n',
  paragraphLabels: 'A paragraph. <para>\n\nTight paragraph<tight>\n\nMid <mid> label stays inline.\n',
  otherLabels: '```rust\nfn main() {}\n```\n<code>\n\n#table(columns: 1, [a]) <tab>\n\n#table(columns: 1, [Cell text <cell>])\n\n= Head <a> more\n',
};

/** The label attribute of every block that has one, in document order. */
function labels(doc: Node): { type: string; name: string; gap: string }[] {
  const found: { type: string; name: string; gap: string }[] = [];
  doc.descendants((node) => {
    if (node.attrs.label) found.push({ type: node.type.name, ...node.attrs.label });
  });
  return found;
}

/** The reference chips, in document order. */
function references(doc: Node): { target: string; supplement: string | null }[] {
  const found: { target: string; supplement: string | null }[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'reference') found.push({ target: node.attrs.target, supplement: node.attrs.supplement });
  });
  return found;
}

describe('references and labels in the Typst ↔ ProseMirror conversion', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        const doc = parseTypst(source);
        expect(serializeToTypst(doc)).toBe(source);
        expectPreciseMap(doc);
      });
    }
  });

  it('parses the advanced example: references are chips, the heading label is an attribute', () => {
    const doc = parseTypst(FIXTURES.introduction);
    expect(references(doc)).toEqual([
      { target: 'method', supplement: null },
      { target: 'results', supplement: null },
      { target: 'fig:compile-times', supplement: null },
    ]);
    expect(labels(doc)).toEqual([{ type: 'heading', name: 'intro', gap: ' ' }]);
    expect(doc.child(1).type.name).toBe('heading');
    expect(doc.child(1).textContent).toBe('Introduction');
    expect(doc.child(2).type.name).toBe('paragraph'); // no raw block for the label
  });

  it('labels figures, tables and equations of the advanced example', () => {
    expect(labels(parseTypst(FIXTURES.results))).toEqual([
      { type: 'heading', name: 'results', gap: ' ' },
      { type: 'figure', name: 'tab:timings', gap: ' ' }, // a figure with a table (tables-real-world)
      { type: 'figure', name: 'fig:compile-times', gap: ' ' },
      { type: 'rawBlock', name: 'tab:runs', gap: ' ' }, // a figure of the spreadsheet's table: code the Visual editor does not model
    ]);
    expect(labels(parseTypst(FIXTURES.method))).toContainEqual({ type: 'rawBlock', name: 'eq:speedup', gap: ' ' });
  });

  it('keeps supplements and stops references before trailing punctuation', () => {
    expect(references(parseTypst(FIXTURES.refs))).toEqual([
      { target: 'method', supplement: null },
      { target: 'results', supplement: null },
      { target: 'fig:compile-times', supplement: null },
      { target: 'key', supplement: '[Chapter]' },
      { target: 'eq:speedup', supplement: null },
    ]);
    expect(references(parseTypst(FIXTURES.punctuation)).map((r) => r.target)).toEqual(['fig:x', 'a:b', 'c', 'd', 'e', 'f']);
  });

  it('finds references in headings, lists, table cells, captions and formatting', () => {
    expect(references(parseTypst(FIXTURES.refsEverywhere)).map((r) => r.target)).toEqual(['intro', 'intro', 'fig:x', 'a', 'b', 'intro', 'x']);
  });

  it('a paragraph of only a reference is a paragraph', () => {
    expect(parseTypst('@intro\n').child(0).type.name).toBe('paragraph');
  });

  it('labels headings with and without space and on the next line; paragraphs at their end only', () => {
    expect(labels(parseTypst(FIXTURES.headingLabels))).toEqual([
      { type: 'heading', name: 'intro', gap: ' ' },
      { type: 'heading', name: 'tight', gap: '' },
      { type: 'heading', name: 'next', gap: '\n' },
    ]);
    const paragraphs = parseTypst(FIXTURES.paragraphLabels);
    expect(labels(paragraphs)).toEqual([
      { type: 'paragraph', name: 'para', gap: ' ' },
      { type: 'paragraph', name: 'tight', gap: '' },
    ]);
    expect(paragraphs.child(0).textContent).toBe('A paragraph.');
    expect(find(paragraphs, 'rawInline').node.attrs.src).toBe('<mid>');
  });

  it('labels code blocks, tables and table cells; a label followed by text stays inline', () => {
    const doc = parseTypst(FIXTURES.otherLabels);
    expect(labels(doc).map((l) => `${l.type}:${l.name}`)).toEqual(['codeBlock:code', 'table:tab', 'paragraph:cell']);
    expect(doc.lastChild!.type.name).toBe('paragraph');
    expect(doc.lastChild!.child(0).attrs.src).toBe('<a>');
  });

  describe('edits', () => {
    it('editing a labelled heading keeps its label', () => {
      const source = '= Introduction <intro>\n\nText\n';
      const doc = edit(parseTypst(source), (s) => s.tr.insertText(' and goals', after(s.doc, 'Introduction')));
      expect(serializeToTypst(doc)).toBe('= Introduction and goals <intro>\n\nText\n');
    });

    it('editing a labelled paragraph keeps its label', () => {
      const doc = edit(parseTypst('Some text<p>\n'), (s) => s.tr.insertText(' more', after(s.doc, 'text')));
      expect(serializeToTypst(doc)).toBe('Some text more<p>\n');
    });

    it('a new label is printed after one space; a removed label takes its gap along', () => {
      const added = edit(parseTypst('= Intro\n\nText\n'), (s) => s.tr.setNodeAttribute(0, 'label', { name: 'intro', gap: ' ' }));
      expect(serializeToTypst(added)).toBe('= Intro <intro>\n\nText\n');
      const removed = edit(parseTypst('= Intro\n<intro>\n\nText\n'), (s) => s.tr.setNodeAttribute(0, 'label', null));
      expect(serializeToTypst(removed)).toBe('= Intro\n\nText\n');
    });

    it('a renamed figure label keeps the figure', () => {
      const source = '#figure(image("a.png"), caption: [A]) <fig:a>\n';
      const doc = edit(parseTypst(source), (s) => s.tr.setNodeAttribute(0, 'label', { name: 'fig:b', gap: ' ' }));
      expect(serializeToTypst(doc)).toBe('#figure(image("a.png"), caption: [A]) <fig:b>\n');
    });

    it('editing text around a reference keeps it', () => {
      const doc = edit(parseTypst('See @method for details.\n'), (s) => s.tr.insertText(' all', after(s.doc, 'for')));
      expect(serializeToTypst(doc)).toBe('See @method for all details.\n');
    });

    it('text typed right after a reference cannot extend it', () => {
      const typed = (text: string) =>
        serializeToTypst(edit(parseTypst('See @method\n'), (s) => s.tr.insertText(text, find(s.doc, 'reference').pos + 1)));
      expect(typed('s')).toBe('See @method\\s\n');
      expect(typed('.x')).toBe('See @method\\.x\n');
      expect(typed('. Next')).toBe('See @method. Next\n');
      expect(typed(':')).toBe('See @method:\n');
      expect(typed(' and')).toBe('See @method and\n');
    });

    it('prints an inserted reference, with its supplement', () => {
      const doc = edit(parseTypst('See x\n'), (s) => {
        const at = after(s.doc, 'See ');
        return s.tr.insert(at, [schema.nodes.reference.create({ target: 'intro' }), schema.nodes.reference.create({ target: 'b', supplement: '[Part]' })]);
      });
      expect(serializeToTypst(doc)).toBe('See @intro@b[Part]x\n');
      expect(references(parseTypst(serializeToTypst(doc))).map((r) => r.target)).toEqual(['intro', 'b']);
    });
  });

  it('syncing a renamed label from the source updates the attribute in place', () => {
    const state = EditorState.create({ doc: parseTypst('= Intro <intro>\n\nSee @intro.\n') });
    const tr = applyTypstChanges(state.tr, parseTypst('= Intro <start>\n\nSee @start.\n'));
    expect(labels(tr.doc)).toEqual([{ type: 'heading', name: 'start', gap: ' ' }]);
    expect(references(tr.doc)).toEqual([{ target: 'start', supplement: null }]);
    expect(serializeToTypst(tr.doc)).toBe('= Intro <start>\n\nSee @start.\n');
  });
});
