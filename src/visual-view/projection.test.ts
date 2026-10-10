import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { schema } from './extensions';
import { posToSource, print, project as projectWith, sourceToPos, syncDoc } from './projection';

const project = (source: string) => projectWith(source, schema);

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
    expect(bold.marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('keeps unmodelled code as raw blocks and raw inlines', () => {
    const doc = project('#set page(margin: 2cm)\n\nA #emph[func] call.');
    expect(doc.child(0).type.name).toBe('rawBlock');
    expect(doc.child(0).attrs.src).toBe('#set page(margin: 2cm)');
    const inline = doc.child(1).child(1);
    expect(inline.type.name).toBe('rawInline');
    expect(inline.attrs.src).toBe('#emph[func]');
  });

  it('projects consecutive list items into one list', () => {
    const doc = project('- one\n- two\n\n+ a\n+ b');
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('bulletList');
    expect(doc.child(0).childCount).toBe(2);
    expect(doc.child(1).type.name).toBe('orderedList');
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
        return s.tr.addMark(to - 'Report'.length, to, schema.marks.bold.create());
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
      const doc = edit(project('abcdef\n'), (s) => s.tr.addMark(3, 5, schema.marks.italic.create()));
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

/** Every position in `doc` whose next character is plain, visible text (not an atom or a decoded escape). */
function visibleChars(doc: Node): { pos: number; char: string }[] {
  const chars: { pos: number; char: string }[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && !node.marks.some((m) => m.type.name === 'typstSource')) {
      for (let i = 0; i < node.text!.length; i++) chars.push({ pos: pos + i, char: node.text![i] });
    }
  });
  return chars;
}

/** Checks the position map of `doc` exhaustively against its printed source. */
function expectPreciseMap(doc: Node): void {
  const source = print(doc);
  for (const { pos, char } of visibleChars(doc)) {
    const offset = posToSource(doc, pos);
    expect(source[offset], `char at position ${pos}`).toBe(char);
    expect(sourceToPos(doc, offset)).toBe(pos);
  }
  let previous = -1;
  for (let offset = 0; offset <= source.length; offset++) {
    const pos = sourceToPos(doc, offset);
    expect(pos, `monotonic at offset ${offset}`).toBeGreaterThanOrEqual(previous);
    expect(pos).toBeLessThanOrEqual(doc.content.size);
    // lands on the same visible character: mapping back and forth again is stable
    expect(sourceToPos(doc, posToSource(doc, pos)), `round trip of offset ${offset}`).toBe(pos);
    previous = pos;
  }
  previous = -1;
  for (let pos = 0; pos <= doc.content.size; pos++) {
    const offset = posToSource(doc, pos);
    expect(offset, `monotonic at position ${pos}`).toBeGreaterThanOrEqual(previous);
    expect(offset).toBeLessThanOrEqual(source.length);
    previous = offset;
  }
}

describe('source offset <-> document position', () => {
  describe('is precise, monotonic and stable for every fixture', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => expectPreciseMap(project(source)));
    }
  });

  it('maps text one to one', () => {
    const doc = project('Hello world');
    expect(sourceToPos(doc, 0)).toBe(1);
    expect(sourceToPos(doc, 6)).toBe(7);
    expect(posToSource(doc, 7)).toBe(6);
    expect(sourceToPos(doc, 11)).toBe(12);
    expect(posToSource(doc, 12)).toBe(11);
  });

  it('snaps hidden syntax to the next visible position', () => {
    const source = 'An *important* point';
    const doc = project(source);
    const bold = after(doc, 'important') - 'important'.length;
    expect(sourceToPos(doc, source.indexOf('*'))).toBe(bold);
    expect(posToSource(doc, bold)).toBe(source.indexOf('important'));
    expect(sourceToPos(doc, source.lastIndexOf('*'))).toBe(after(doc, 'important'));
  });

  it('maps an atom (raw inline, decoded escape) to the position before it', () => {
    const source = 'A #emph[func] call and \\* star';
    const doc = project(source);
    const raw = after(doc, 'A ');
    expect(sourceToPos(doc, source.indexOf('emph'))).toBe(raw);
    expect(posToSource(doc, raw)).toBe(source.indexOf('#'));
    expect(posToSource(doc, raw + 1)).toBe(source.indexOf(' call'));
    expect(sourceToPos(doc, source.indexOf('*'))).toBe(after(doc, 'call and '));
  });

  it('maps heading and list markers and separators to the following text', () => {
    const source = '= Title\n\n- one\n- two\n';
    const doc = project(source);
    expect(sourceToPos(doc, 0)).toBe(after(doc, 'Title') - 'Title'.length);
    expect(sourceToPos(doc, source.indexOf('- two'))).toBe(after(doc, 'two') - 'two'.length);
    expect(sourceToPos(doc, source.indexOf('\n\n'))).toBe(after(doc, 'one') - 'one'.length);
  });

  it('maps the end of a range to just after its last visible character', () => {
    const source = 'ab\n\n*cd*\n\nef';
    const doc = project(source);
    expect(sourceToPos(doc, 2)).toBe(after(doc, 'cd') - 2);
    expect(sourceToPos(doc, 2, -1)).toBe(after(doc, 'ab'));
    expect(posToSource(doc, after(doc, 'ab'))).toBe(2);
    expect(sourceToPos(doc, source.indexOf('\n\nef'), -1)).toBe(after(doc, 'cd'));
    expect(sourceToPos(doc, 0, -1)).toBe(1);
  });

  it('maps a range end back to just after the source of its last visible character', () => {
    const source = 'An *important* #emph[x] point\n\n= Next';
    const doc = project(source);
    expect(posToSource(doc, after(doc, 'important'), -1)).toBe(source.indexOf('important') + 'important'.length);
    expect(posToSource(doc, after(doc, 'important') + 2, -1)).toBe(source.indexOf(' point'));
    expect(posToSource(doc, after(doc, 'point'), -1)).toBe(source.indexOf('\n\n'));
    expect(posToSource(doc, after(doc, 'An'), -1)).toBe(2);
  });

  it('places the end of the source at the end of the last block', () => {
    const doc = project('Text\n\n');
    expect(sourceToPos(doc, 6)).toBe(after(doc, 'Text'));
  });

  it('stays precise in edited blocks, where text is escaped and marks re-printed', () => {
    const typed = edit(project('Hi\n'), (s) => s.tr.insertText(' *a* #b', after(s.doc, 'Hi')));
    expect(print(typed)).toBe('Hi \\*a\\* \\#b\n');
    expectPreciseMap(typed);

    const bolded = edit(project('= Report\n\nab cd ef\n'), (s) => {
      const cd = after(s.doc, 'cd');
      const report = after(s.doc, 'Report');
      return s.tr.addMark(cd - 2, cd, schema.marks.bold.create()).addMark(report - 6, report, schema.marks.italic.create());
    });
    expect(print(bolded)).toBe('= _Report_\n\nab *cd* ef\n');
    expectPreciseMap(bolded);
  });

  it('stays precise in indented nested lists', () => {
    const doc = edit(project('- one\n- two\n'), (s) => {
      const nested = schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('deep'))),
      ]);
      return s.tr.insert(after(s.doc, 'one') + 1, nested);
    });
    expect(print(doc)).toBe('- one\n  - deep\n- two\n');
    expectPreciseMap(doc);
    expect(posToSource(doc, after(doc, 'de'))).toBe(print(doc).indexOf('ep'));
  });

  it('stays precise after syncing an outside change', () => {
    const state = EditorState.create({ doc: project('A *b* c\n\nOther -- text\n') });
    const synced = state.apply(syncDoc(state.tr, project('A *bb* c\n\nOther -- text!\n'))).doc;
    expectPreciseMap(synced);
    expect(posToSource(synced, after(synced, 'text'))).toBe('A *bb* c\n\nOther -- text'.length);
  });
});

describe('syncDoc', () => {
  it('keeps the cursor in a paragraph that changed elsewhere', () => {
    const before = project('Hello world, this is text\n');
    const cursor = 'Hello'.length + 1;
    const state = EditorState.create({ doc: before, selection: TextSelection.create(before, cursor) });
    const tr = syncDoc(state.tr, project('Hello world, this is more text\n'));
    expect(tr.selection.from).toBe(cursor);
    expect(tr.doc.textContent).toBe('Hello world, this is more text');
  });

  it('keeps nodes pristine after syncing, so later edits elsewhere print exact source', () => {
    const state = EditorState.create({ doc: project('A -- b\n\nOther\n') });
    const synced = state.apply(syncDoc(state.tr, project('A -- bc\n\nOther\n')));
    const edited = synced.apply(synced.tr.insertText('!', after(synced.doc, 'Other')));
    expect(print(edited.doc)).toBe('A -- bc\n\nOther!\n');
  });

  it('replaces only the top-level blocks that differ', () => {
    const before = project('= A\n\nOne\n\nTwo\n');
    const after = project('= A\n\nOne changed\n\nTwo\n');
    const state = EditorState.create({ doc: before });
    const tr = syncDoc(state.tr, after);
    expect(tr.doc.eq(after)).toBe(true);
    expect(tr.doc.child(0)).toBe(before.child(0));
    expect(tr.doc.child(2)).toBe(before.child(2));
    expect(print(tr.doc)).toBe('= A\n\nOne changed\n\nTwo\n');
  });

  it('updates leading and trailing whitespace', () => {
    const tr = syncDoc(EditorState.create({ doc: project('A\n') }).tr, project('\nA\n\n'));
    expect(print(tr.doc)).toBe('\nA\n\n');
  });
});
