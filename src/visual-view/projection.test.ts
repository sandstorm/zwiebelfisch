import { describe, expect, it } from 'vitest';
import type { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { print, project } from './projection';
import { schema } from './schema';

const FIXTURES: Record<string, string> = {
  empty: '',
  plain: 'Hello world',
  trailingNewline: 'Hello world\n',
  leadingBlankLines: '\n\nHello',
  paragraphs: 'First paragraph\ncontinues here.\n\n\nSecond   paragraph.\n',
  marks: 'Sales were _good_ and *very \\* nice*, `code` and $x^2$.',
  headings: '= Title <intro>\n\n== Sub *bold*\n\nText\n',
  setRules: '#set page(margin: 2cm)\n#set text(lang: "de")\n\n= Report\n',
  lists: '- one\n- two\n  - nested\n+ first\n+ second\n\n1. explicit\n',
  breaks: 'Line one \\\nline two -- dash...\n',
  codeAndMath: '#let x = 1\n\n$ a + b $\n\n#figure(image("a.png"), caption: [Hi])\n\n```rust\nfn main() {}\n```\n',
  comments: '// a comment\nText /* inline */ more\n',
  unicode: 'Größe 😀 naïve\n',
  broken: '#set page(\n\n*unclosed\n',
};

function edit(doc: Node, change: (state: EditorState) => EditorState['tr']): Node {
  const state = EditorState.create({ doc });
  return state.apply(change(state)).doc;
}

/** Position just after the first occurrence of `text` in the visual doc. */
function after(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + text.length;
  });
  if (found < 0) throw new Error(`"${text}" not found`);
  return found;
}

describe('projection', () => {
  describe('round-trips every fixture byte for byte', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => expect(print(project(source))).toBe(source));
    }
  });

  it('projects headings, paragraphs and marks into real nodes', () => {
    const doc = project('= Title\n\nSome *bold* and _it_ text.');
    expect(doc.child(0).type.name).toBe('heading');
    expect(doc.child(0).attrs.level).toBe(1);
    expect(doc.child(0).textContent).toBe('Title');
    const paragraph = doc.child(1);
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.textContent).toBe('Some bold and it text.');
    const bold = paragraph.child(1);
    expect(bold.text).toBe('bold');
    expect(bold.marks.map((m) => m.type.name)).toEqual(['strong']);
  });

  it('keeps unmodelled code as raw blocks and raw inlines', () => {
    const doc = project('#set page(margin: 2cm)\n\nA #emph[func] call.');
    expect(doc.child(0).type.name).toBe('raw_block');
    expect(doc.child(0).attrs.src).toBe('#set page(margin: 2cm)');
    const inline = doc.child(1).child(1);
    expect(inline.type.name).toBe('raw_inline');
    expect(inline.attrs.src).toBe('#emph[func]');
  });

  it('projects consecutive list items into one list', () => {
    const doc = project('- one\n- two\n\n+ a\n+ b');
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('bullet_list');
    expect(doc.child(0).childCount).toBe(2);
    expect(doc.child(1).type.name).toBe('ordered_list');
  });

  describe('edits change only the edited block', () => {
    const source = '#set text(lang: "en")\n\n= Report\n\nSales  were\n_good_.\n\nOther -- text\n';

    it('typing inside a paragraph', () => {
      const doc = edit(project(source), (s) => s.tr.insertText(' very', after(s.doc, 'were')));
      expect(print(doc)).toBe(source.replace('were\n', 'were very\n'));
    });

    it('making text bold', () => {
      const doc = edit(project(source), (s) => {
        const to = after(s.doc, 'Report');
        return s.tr.addMark(to - 'Report'.length, to, schema.marks.strong.create());
      });
      expect(print(doc)).toBe(source.replace('= Report', '= *Report*'));
    });

    it('splitting a paragraph', () => {
      const doc = edit(project(source), (s) => s.tr.split(after(s.doc, 'Other')));
      expect(print(doc)).toBe(source.replace('Other -- text', 'Other\n\n -- text'));
    });

    it('adding a paragraph at the end', () => {
      const doc = edit(project(source), (s) => {
        const end = s.doc.content.size;
        return s.tr.insert(end, schema.nodes.paragraph.create(null, schema.text('New')));
      });
      expect(print(doc)).toBe(`${source.trimEnd()}\n\nNew\n`);
    });

    it('escapes markup characters in typed text', () => {
      const doc = edit(project('Hi\n'), (s) => s.tr.insertText(' *a* #b $c$ @d <e> \\f // g', after(s.doc, 'Hi')));
      expect(print(doc)).toBe('Hi \\*a\\* \\#b \\$c\\$ \\@d \\<e> \\\\f \\// g\n');
    });

    it('escapes list and heading markers at the start of a line', () => {
      for (const [typed, printed] of [['= no heading', '\\= no heading'], ['- no list', '\\- no list'], ['1. no enum', '1\\. no enum']]) {
        const doc = edit(project('\n'), (s) => s.tr.insertText(typed, 1));
        expect(print(doc)).toBe(`\n${printed}`);
      }
    });

    it('uses function syntax for marks inside words', () => {
      const doc = edit(project('abcdef\n'), (s) => s.tr.addMark(3, 5, schema.marks.emph.create()));
      expect(print(doc)).toBe('ab#emph[cd]ef\n');
    });

    it('adding a list item', () => {
      const listSource = '- one\n- two\n\nAfter\n';
      const doc = edit(project(listSource), (s) => {
        const pos = after(s.doc, 'two');
        return s.tr.split(pos, 2);
      });
      expect(print(doc)).toBe('- one\n- two\n- \n\nAfter\n');
    });
  });
});
