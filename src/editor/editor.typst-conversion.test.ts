// The Typst ↔ ProseMirror conversion with the built-in extensions' specs: every fixture round-trips, edits stay minimal, the
// position maps are precise (integration: src/testing composes the built-ins; the framework's own tests are in
// hosts/visual-editor/typst-conversion/typst-conversion.test.ts).
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { posToSource, serializeToTypst, sourceToPos, applyTypstChanges, typstChanges } from '../hosts/visual-editor/visual-editor';
import { after, builtins, edit, expectPreciseMap, parseTypst, schema, schemaOf } from '../testing/testing';
import { SourceOffset, type TextChange } from '../core/typst-document/typst-document';


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
  underline: 'An #underline[under *lined*] word, *#underline[x]*, #underline(stroke: red)[kept] #underline()[y] #underline[]\n',
  strike: 'A #strike[struck *out*] word, _#strike[x]_, #strike(stroke: 2pt)[kept] #strike()[y] #strike[]\n',
  highlight: 'A #highlight[marked _up_] word, #highlight(fill: blue)[kept] #highlight[#strike[both]] #highlight[a\n\nb]\n',
  links: 'See #link("https://typst.app")[the *site*] or https://typst.app/docs.\n#link("x")[] #link(url)[a]\n',
  images: '#image("img/logo.png", width: 50%)\n\nText #image("i.png") inline\n',
  tables: '#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n)\n\n#table(columns: 1, [one\n\ntwo])\n',
  rawTables: '#table(columns: (1fr, 1fr), [a], [b])\n\n#table(columns: 2, [a], [b], [c])\n\n#table(columns: 1, table.header[H], [a])\n',
  code: 'Use `x` and ``` `y` ``` or ```js a``` *`b`*.\n\n```rust\nfn main() {}\n```\n\n````\na```b\n````\n\n```\n```\n\n`a\nb` ``\n',
  outline: '#outline()\n\n#outline(title: [Contents], depth: 2)\n\nText #outline() inline\n',
  figures:
    '#figure(image("x.png", width: 50%), caption: [Some *caption*]) <fig:x>\n\n' +
    '#figure(\n  image("a.png", height: 2cm, fit: "contain", alt: "A"),\n  placement: top,\n' +
    '  caption: [ With #link("https://a.org")[a link] and `code` ],\n  kind: image,\n)\n<fig:y>\n\n' +
    '#figure(image("b.png"))\n\n#figure(image("c.png"), caption: [])<c>\n\n' +
    '#table(columns: 1, [#figure(image("t.png"), caption: [In a cell])])\n',
  rawFigures:
    '#figure([text], caption: [x])\n\n#figure(image("a.png"), caption: [a\n\nb])\n\n' +
    '#figure(table(columns: 1, [a], table.hline()))\n\n#figure(image(p), caption: [x])\n\n#figure(image("a.png")) <a> <b>\n',
};

describe('Typst ↔ ProseMirror conversion', () => {
  describe('round-trips every fixture byte for byte', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => expect(serializeToTypst(parseTypst(source))).toBe(source));
    }
  });

  it('parses headings, paragraphs and marks into real nodes', () => {
    const doc = parseTypst('= Title\n\nSome *bold* and _it_ text.');
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
    const doc = parseTypst('#set page(margin: 2cm)\n\nA #emph[func] call.');
    expect(doc.child(0).type.name).toBe('rawBlock');
    expect(doc.child(0).attrs.src).toBe('#set page(margin: 2cm)');
    const inline = doc.child(1).child(1);
    expect(inline.type.name).toBe('rawInline');
    expect(inline.attrs.src).toBe('#emph[func]');
  });

  it('parses consecutive list items into one list', () => {
    const doc = parseTypst('- one\n- two\n\n+ a\n+ b');
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('bulletList');
    expect(doc.child(0).childCount).toBe(2);
    expect(doc.child(1).type.name).toBe('orderedList');
  });

  describe('edits change only the edited block', () => {
    const source = '#set text(lang: "en")\n\n= Report\n\nSales  were\n_good_.\n\nOther -- text\n';

    it('typing inside a paragraph', () => {
      const doc = edit(parseTypst(source), (s) => s.tr.insertText(' very', after(s.doc, 'were')));
      expect(serializeToTypst(doc)).toBe(source.replace('were\n', 'were very\n'));
    });

    it('making text bold', () => {
      const doc = edit(parseTypst(source), (s) => {
        const to = after(s.doc, 'Report');
        return s.tr.addMark(to - 'Report'.length, to, schema.marks.bold.create());
      });
      expect(serializeToTypst(doc)).toBe(source.replace('= Report', '= *Report*'));
    });

    it('splitting a paragraph', () => {
      const doc = edit(parseTypst(source), (s) => s.tr.split(after(s.doc, 'Other')));
      expect(serializeToTypst(doc)).toBe(source.replace('Other -- text', 'Other\n\n -- text'));
    });

    it('adding a paragraph at the end', () => {
      const doc = edit(parseTypst(source), (s) => {
        const end = s.doc.content.size;
        return s.tr.insert(end, schema.nodes.paragraph.create(null, schema.text('New')));
      });
      expect(serializeToTypst(doc)).toBe(`${source.trimEnd()}\n\nNew\n`);
    });

    it('escapes markup characters in typed text', () => {
      const doc = edit(parseTypst('Hi\n'), (s) => s.tr.insertText(' *a* #b $c$ @d <e> \\f // g', after(s.doc, 'Hi')));
      expect(serializeToTypst(doc)).toBe('Hi \\*a\\* \\#b \\$c\\$ \\@d \\<e> \\\\f \\// g\n');
    });

    it('escapes list and heading markers at the start of a line', () => {
      for (const [typed, printed] of [['= no heading', '\\= no heading'], ['- no list', '\\- no list'], ['1. no enum', '1\\. no enum']]) {
        const doc = edit(parseTypst('\n'), (s) => s.tr.insertText(typed, 1));
        expect(serializeToTypst(doc)).toBe(`\n${printed}`);
      }
    });

    it('uses function syntax for marks inside words', () => {
      const doc = edit(parseTypst('abcdef\n'), (s) => s.tr.addMark(3, 5, schema.marks.italic.create()));
      expect(serializeToTypst(doc)).toBe('ab#emph[cd]ef\n');
    });

    it('adding a list item', () => {
      const listSource = '- one\n- two\n\nAfter\n';
      const doc = edit(parseTypst(listSource), (s) => {
        const pos = after(s.doc, 'two');
        return s.tr.split(pos, 2);
      });
      expect(serializeToTypst(doc)).toBe('- one\n- two\n- \n\nAfter\n');
    });
  });
});

describe('source offset <-> document position', () => {
  describe('is precise, monotonic and stable for every fixture', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => expectPreciseMap(parseTypst(source)));
    }
  });

  it('maps text one to one', () => {
    const doc = parseTypst('Hello world');
    expect(sourceToPos(doc, SourceOffset.of(0))).toBe(1);
    expect(sourceToPos(doc, SourceOffset.of(6))).toBe(7);
    expect(posToSource(doc, 7)).toBe(6);
    expect(sourceToPos(doc, SourceOffset.of(11))).toBe(12);
    expect(posToSource(doc, 12)).toBe(11);
  });

  it('snaps hidden syntax to the next visible position', () => {
    const source = 'An *important* point';
    const doc = parseTypst(source);
    const bold = after(doc, 'important') - 'important'.length;
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('*')))).toBe(bold);
    expect(posToSource(doc, bold)).toBe(source.indexOf('important'));
    expect(sourceToPos(doc, SourceOffset.of(source.lastIndexOf('*')))).toBe(after(doc, 'important'));
  });

  it('maps an atom (raw inline, decoded escape) to the position before it', () => {
    const source = 'A #emph[func] call and \\* star';
    const doc = parseTypst(source);
    const raw = after(doc, 'A ');
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('emph')))).toBe(raw);
    expect(posToSource(doc, raw)).toBe(source.indexOf('#'));
    expect(posToSource(doc, raw + 1)).toBe(source.indexOf(' call'));
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('*')))).toBe(after(doc, 'call and '));
  });

  it('maps heading and list markers and separators to the following text', () => {
    const source = '= Title\n\n- one\n- two\n';
    const doc = parseTypst(source);
    expect(sourceToPos(doc, SourceOffset.of(0))).toBe(after(doc, 'Title') - 'Title'.length);
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('- two')))).toBe(after(doc, 'two') - 'two'.length);
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('\n\n')))).toBe(after(doc, 'one') - 'one'.length);
  });

  it('maps the end of a range to just after its last visible character', () => {
    const source = 'ab\n\n*cd*\n\nef';
    const doc = parseTypst(source);
    expect(sourceToPos(doc, SourceOffset.of(2))).toBe(after(doc, 'cd') - 2);
    expect(sourceToPos(doc, SourceOffset.of(2), -1)).toBe(after(doc, 'ab'));
    expect(posToSource(doc, after(doc, 'ab'))).toBe(2);
    expect(sourceToPos(doc, SourceOffset.of(source.indexOf('\n\nef')), -1)).toBe(after(doc, 'cd'));
    expect(sourceToPos(doc, SourceOffset.of(0), -1)).toBe(1);
  });

  it('maps a range end back to just after the source of its last visible character', () => {
    const source = 'An *important* #emph[x] point\n\n= Next';
    const doc = parseTypst(source);
    expect(posToSource(doc, after(doc, 'important'), -1)).toBe(source.indexOf('important') + 'important'.length);
    expect(posToSource(doc, after(doc, 'important') + 2, -1)).toBe(source.indexOf(' point'));
    expect(posToSource(doc, after(doc, 'point'), -1)).toBe(source.indexOf('\n\n'));
    expect(posToSource(doc, after(doc, 'An'), -1)).toBe(2);
  });

  it('places the end of the source at the end of the last block', () => {
    const doc = parseTypst('Text\n\n');
    expect(sourceToPos(doc, SourceOffset.of(6))).toBe(after(doc, 'Text'));
  });

  it('stays precise in edited blocks, where text is escaped and marks re-printed', () => {
    const typed = edit(parseTypst('Hi\n'), (s) => s.tr.insertText(' *a* #b', after(s.doc, 'Hi')));
    expect(serializeToTypst(typed)).toBe('Hi \\*a\\* \\#b\n');
    expectPreciseMap(typed);

    const bolded = edit(parseTypst('= Report\n\nab cd ef\n'), (s) => {
      const cd = after(s.doc, 'cd');
      const report = after(s.doc, 'Report');
      return s.tr.addMark(cd - 2, cd, schema.marks.bold.create()).addMark(report - 6, report, schema.marks.italic.create());
    });
    expect(serializeToTypst(bolded)).toBe('= _Report_\n\nab *cd* ef\n');
    expectPreciseMap(bolded);
  });

  it('stays precise in indented nested lists', () => {
    const doc = edit(parseTypst('- one\n- two\n'), (s) => {
      const nested = schema.nodes.bulletList.create(null, [
        schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, schema.text('deep'))),
      ]);
      return s.tr.insert(after(s.doc, 'one') + 1, nested);
    });
    expect(serializeToTypst(doc)).toBe('- one\n  - deep\n- two\n');
    expectPreciseMap(doc);
    expect(posToSource(doc, after(doc, 'de'))).toBe(serializeToTypst(doc).indexOf('ep'));
  });

  it('stays precise after syncing an outside change', () => {
    const state = EditorState.create({ doc: parseTypst('A *b* c\n\nOther -- text\n') });
    const synced = state.apply(applyTypstChanges(state.tr, parseTypst('A *bb* c\n\nOther -- text!\n'))).doc;
    expectPreciseMap(synced);
    expect(posToSource(synced, after(synced, 'text'))).toBe('A *bb* c\n\nOther -- text'.length);
  });
});

describe('applyTypstChanges', () => {
  it('keeps the cursor in a paragraph that changed elsewhere', () => {
    const before = parseTypst('Hello world, this is text\n');
    const cursor = 'Hello'.length + 1;
    const state = EditorState.create({ doc: before, selection: TextSelection.create(before, cursor) });
    const tr = applyTypstChanges(state.tr, parseTypst('Hello world, this is more text\n'));
    expect(tr.selection.from).toBe(cursor);
    expect(tr.doc.textContent).toBe('Hello world, this is more text');
  });

  it('keeps nodes unchanged since parsed after syncing, so later edits elsewhere print exact source', () => {
    const state = EditorState.create({ doc: parseTypst('A -- b\n\nOther\n') });
    const synced = state.apply(applyTypstChanges(state.tr, parseTypst('A -- bc\n\nOther\n')));
    const edited = synced.apply(synced.tr.insertText('!', after(synced.doc, 'Other')));
    expect(serializeToTypst(edited.doc)).toBe('A -- bc\n\nOther!\n');
  });

  it('replaces only the top-level blocks that differ', () => {
    const before = parseTypst('= A\n\nOne\n\nTwo\n');
    const after = parseTypst('= A\n\nOne changed\n\nTwo\n');
    const state = EditorState.create({ doc: before });
    const tr = applyTypstChanges(state.tr, after);
    expect(tr.doc.eq(after)).toBe(true);
    expect(tr.doc.child(0)).toBe(before.child(0));
    expect(tr.doc.child(2)).toBe(before.child(2));
    expect(serializeToTypst(tr.doc)).toBe('= A\n\nOne changed\n\nTwo\n');
  });

  it('updates leading and trailing whitespace', () => {
    const tr = applyTypstChanges(EditorState.create({ doc: parseTypst('A\n') }).tr, parseTypst('\nA\n\n'));
    expect(serializeToTypst(tr.doc)).toBe('\nA\n\n');
  });
});

describe('typstChanges', () => {
  /** Edits that touch one place or several, made of one step or many; those a document has no place for are skipped. */
  const EDITS: Record<string, (tr: Transaction) => unknown> = {
    'typing in every textblock': (tr) => textblocks(tr.doc).reverse().forEach(({ end }) => tr.insertText(' *x*', end)),
    'typing at the start of a textblock': (tr) => tr.insertText('- a', textblocks(tr.doc)[0].start),
    'deleting the first character of every textblock': (tr) =>
      textblocks(tr.doc).filter(({ start, end }) => end > start).reverse().forEach(({ start }) => tr.delete(start, start + 1)),
    'making the first and last textblock bold': (tr) =>
      [textblocks(tr.doc)[0], textblocks(tr.doc).at(-1)!].forEach(({ start, end }) => tr.addMark(start, end, schema.marks.bold.create())),
    'removing all formatting': (tr) => tr.removeMark(0, tr.doc.content.size),
    'splitting the first textblock': (tr) => tr.split(middle(textblocks(tr.doc)[0])),
    'splitting the last textblock twice': (tr) => tr.split(middle(textblocks(tr.doc).at(-1)!)).split(textblocks(tr.doc).at(-1)!.start),
    'joining the first two textblocks': (tr) => tr.delete(textblocks(tr.doc)[0].end, textblocks(tr.doc)[1].start),
    'turning the first textblock into a heading': (tr) => tr.setBlockType(textblocks(tr.doc)[0].start, textblocks(tr.doc)[0].start, schema.nodes.heading, { level: 2 }),
    'adding a paragraph at the start and at the end': (tr) =>
      tr.insert(tr.doc.content.size, schema.nodes.paragraph.create(null, schema.text('End'))).insert(0, schema.nodes.paragraph.create(null, schema.text('Start'))),
    'deleting the first block': (tr) => tr.delete(0, tr.doc.firstChild!.nodeSize),
    'deleting the second block and typing in the last': (tr) =>
      tr.delete(tr.doc.child(0).nodeSize, tr.doc.child(0).nodeSize + tr.doc.child(1).nodeSize).insertText('!', textblocks(tr.doc).at(-1)!.end),
    'deleting everything': (tr) => tr.delete(0, tr.doc.content.size),
  };

  for (const [name, source] of Object.entries(FIXTURES)) {
    describe(`turns ${name}'s text into the edited document's`, () => {
      for (const [editName, change] of Object.entries(EDITS)) {
        it(editName, () => {
          const tr = EditorState.create({ doc: parseTypst(source) }).tr;
          try {
            change(tr);
          } catch {
            return;
          }
          expectChanges(source, tr);
        });
      }

      it('random edits', () => {
        const random = seeded(name.length);
        for (let round = 0; round < 20; round++) {
          const tr = EditorState.create({ doc: parseTypst(source) }).tr;
          for (let step = 0; step < 3; step++) randomEdit(tr, random);
          expectChanges(source, tr);
        }
      });
    });
  }

  it('changes only the blocks edited, not the text between them', () => {
    const source = '= Title\n\nOne\n\n- a\n- b\n\nTwo\n';
    const tr = EditorState.create({ doc: parseTypst(source) }).tr;
    tr.insertText('!', after(tr.doc, 'Two')).insertText('*', after(tr.doc, 'Title'));
    expect(typstChanges(tr)).toEqual([
      { from: 7, to: 7, insert: '\\*' },
      { from: source.length - 1, to: source.length - 1, insert: '!' },
    ]);
  });

  it('changes the separator a block insert needs, not the blocks around it', () => {
    const source = 'One\n\nTwo\n';
    const tr = EditorState.create({ doc: parseTypst(source) }).tr;
    tr.insert(tr.doc.child(0).nodeSize, schema.nodes.paragraph.create(null, schema.text('New')));
    expect(typstChanges(tr)).toEqual([{ from: 3, to: 3, insert: '\n\nNew' }]);
  });

  it('starts from the given text where the document printed something else', () => {
    const tr = EditorState.create({ doc: parseTypst('One\n\nTwo\n') }).tr;
    tr.insertText('!', after(tr.doc, 'Two'));
    expect(applied('One\n\nOne and a half\n\nTwo\n', typstChanges(tr, 'One\n\nOne and a half\n\nTwo\n'))).toBe('One\n\nTwo!\n');
  });
});

/** Checks that `typstChanges(tr)` are ordered, apart, and turn `source` into the Typst of `tr.doc`. */
function expectChanges(source: string, tr: Transaction): void {
  const changes = typstChanges(tr);
  changes.slice(1).forEach((change, i) => expect(change.from).toBeGreaterThan(changes[i].to));
  expect(applied(source, changes)).toBe(serializeToTypst(tr.doc));
}

function applied(text: string, changes: readonly TextChange[]): string {
  return [...changes].reverse().reduce((current, { from, to, insert }) => current.slice(0, from) + insert + current.slice(to), text);
}

/** The content ranges of the textblocks of `doc`, in order. */
function textblocks(doc: Node): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) found.push({ start: pos + 1, end: pos + node.nodeSize - 1 });
  });
  return found;
}

const middle = ({ start, end }: { start: number; end: number }) => (start + end) >> 1;

/** A small deterministic random number generator (0 ≤ n < 1). */
function seeded(seed: number): () => number {
  let state = seed + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** Types, deletes, formats, splits or joins somewhere in the textblocks of `tr.doc`; skipped where that does not fit. */
function randomEdit(tr: Transaction, random: () => number): void {
  const blocks = textblocks(tr.doc);
  if (blocks.length === 0) return;
  const block = blocks[Math.floor(random() * blocks.length)];
  const at = block.start + Math.floor(random() * (block.end - block.start + 1));
  const to = Math.min(block.end, at + Math.floor(random() * 4));
  const edits = [
    () => tr.insertText(['a', ' ', '*', '\n', '= ', '#'][Math.floor(random() * 6)], at),
    () => tr.delete(at, to),
    () => tr.addMark(at, to, [schema.marks.bold, schema.marks.italic][Math.floor(random() * 2)].create()),
    () => tr.split(at),
    () => tr.delete(block.start - 2, block.start),
  ];
  try {
    edits[Math.floor(random() * edits.length)]();
  } catch {
    // no such edit there
  }
}

/** The position inside the first empty textblock of `doc`. */
function insideEmptyBlock(doc: Node): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.content.size === 0) found = pos + 1;
    return found < 0;
  });
  if (found < 0) throw new Error('no empty textblock');
  return found;
}

const linkMark = (href: string) => schema.marks.link.create({ href });
const hrefsOf = (node: Node) => node.marks.filter((m) => m.type.name === 'link').map((m) => m.attrs.href as string);

describe('links', () => {
  it('parses #link("url")[text] and bare URLs as link marks over their text', () => {
    const doc = parseTypst('See #link("https://typst.app")[the *site*] or https://typst.app/docs.');
    const paragraph = doc.child(0);
    expect(paragraph.textContent).toBe('See the site or https://typst.app/docs.');
    const site = paragraph.child(2);
    expect(site.text).toBe('site');
    expect(hrefsOf(site)).toEqual(['https://typst.app']);
    expect(site.marks.some((m) => m.type.name === 'bold')).toBe(true);
    const bare = paragraph.child(4);
    expect(bare.text).toBe('https://typst.app/docs');
    expect(hrefsOf(bare)).toEqual(['https://typst.app/docs']);
  });

  it('keeps links it cannot model as raw inlines', () => {
    for (const src of ['#link("x")[]', '#link(url)[a]', '#link("a\\nb")[c]', '#link("x")', '#link("x")[a\n\nb]']) {
      const doc = parseTypst(`A ${src} b`);
      expect(doc.child(0).child(1).type.name, src).toBe('rawInline');
    }
  });

  it('re-prints an edited paragraph with its links intact', () => {
    const source = 'x #link("https://a.org")[*a* b] and https://b.org/x y\n';
    const doc = edit(parseTypst(source), (s) => s.tr.insertText('!', after(s.doc, ' y')));
    expect(serializeToTypst(doc)).toBe('x #link("https://a.org")[*a* b] and https://b.org/x y!\n');
  });

  it('typing inside link text keeps the link', () => {
    const doc = edit(parseTypst('#link("https://a.org")[site]\n'), (s) => s.tr.insertText('X', after(s.doc, 'si')));
    expect(serializeToTypst(doc)).toBe('#link("https://a.org")[siXte]\n');
  });

  it('adding a link to text prints #link, quoting the URL', () => {
    const doc = edit(parseTypst('Read the docs now\n'), (s) => {
      const to = after(s.doc, 'docs');
      return s.tr.addMark(to - 4, to, linkMark('https://x.org/?q="1"'));
    });
    expect(serializeToTypst(doc)).toBe('Read the #link("https://x.org/?q=\\"1\\"")[docs] now\n');
  });

  it('prints a link whose text is its URL as a bare URL, where Typst reads it back', () => {
    const url = 'https://typst.app/docs';
    // typed text, so the URL is not linked yet
    const linked = (source: string) =>
      edit(parseTypst(source), (s) => {
        const at = after(s.doc, 'See ');
        return s.tr.insertText(url, at).addMark(at, at + url.length, linkMark(url));
      });
    expect(serializeToTypst(linked('See  now\n'))).toBe(`See ${url} now\n`);
    expect(serializeToTypst(linked('See .\n'))).toBe(`See #link("${url}")[https:\\//typst.app/docs].\n`);
  });

  it('removing a link leaves plain text', () => {
    const doc = edit(parseTypst('A #link("https://a.org")[site] b\n'), (s) => {
      const to = after(s.doc, 'site');
      return s.tr.removeMark(to - 4, to, schema.marks.link);
    });
    expect(serializeToTypst(doc)).toBe('A site b\n');
  });

  it('escapes a parenthesis right after a function call, which would continue it', () => {
    const doc = edit(parseTypst('Hi\n'), (s) => s.tr.insertText('(note)', after(s.doc, 'Hi')).addMark(1, 3, linkMark('https://a.org')));
    expect(serializeToTypst(doc)).toBe('#link("https://a.org")[Hi]\\(note)\n');
  });

  it('keeps the position map precise around edited links', () => {
    const doc = edit(parseTypst('A #link("https://a.org")[site] and https://b.org b\n'), (s) => s.tr.insertText('!', after(s.doc, ' b')));
    expectPreciseMap(doc);
  });
});

describe('images', () => {
  it('parses a standalone #image call as an image block', () => {
    const doc = parseTypst('#image("img/logo.png", width: 50%)\n\nText #image("i.png")\n');
    expect(doc.child(0).type.name).toBe('image');
    expect(doc.child(0).attrs.src).toBe('#image("img/logo.png", width: 50%)');
    expect(doc.child(1).child(1).type.name).toBe('rawInline');
  });

  it('keeps other image calls raw', () => {
    for (const src of ['#image(path)', '#image("a.png") #image("b.png")', '#image("a.png").x']) {
      expect(parseTypst(src).child(0).type.name, src).not.toBe('image');
    }
  });

});

describe('tables', () => {
  const source = '#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n)\n';

  it('parses a table of content cells into rows and cells', () => {
    const table = parseTypst(source).child(0);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2);
    expect(table.child(0).childCount).toBe(2);
    expect(table.child(0).child(1).textContent).toBe('b c');
    expect(table.child(1).child(0).child(0).type.name).toBe('paragraph');
    expect(table.child(1).child(1).child(0).type.name).toBe('bulletList');
  });

  it('parses multi-paragraph cells as several blocks', () => {
    const cell = parseTypst('#table(columns: 1, [one\n\ntwo])').child(0).child(0).child(0);
    expect(cell.childCount).toBe(2);
  });

  it('keeps tables it cannot model raw', () => {
    for (const src of [
      '#table(columns: cols, [a], [b])',
      '#table(columns: 2, [a], [b], [c])',
      '#table([a], [b])',
      '#table(columns: 1, [a]',
    ]) {
      expect(parseTypst(src).child(0).type.name, src).toBe('rawBlock');
    }
  });

  it('editing a cell changes only that cell', () => {
    const doc = edit(parseTypst(source), (s) => s.tr.insertText('!', after(s.doc, ' c')));
    expect(serializeToTypst(doc)).toBe(source.replace('*b* c]', '*b* c!]'));
    expectPreciseMap(doc);
  });

  it('typing into an empty cell fills its brackets', () => {
    const doc = edit(parseTypst(source), (s) => s.tr.insertText('new', insideEmptyBlock(s.doc)));
    expect(serializeToTypst(doc)).toBe(source.replace('[], [-', '[new], [-'));
  });

  it('re-prints a table whose shape changed, keeping its other arguments', () => {
    const doc = edit(parseTypst(source), (s) => {
      const table = s.doc.child(0);
      const row = schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, schema.text('e'))),
        schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
      ]);
      return s.tr.insert(table.nodeSize - 1, row);
    });
    expect(serializeToTypst(doc)).toBe('#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n  [e], [],\n)\n');
    expectPreciseMap(doc);
  });

  it('prints a table created in the editor', () => {
    const cell = (text?: string) => schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null));
    const table = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell('*'), cell()]),
      schema.nodes.tableRow.create(null, [cell('- no list'), cell('x]')]),
    ]);
    const doc = edit(parseTypst('Text\n'), (s) => s.tr.insert(s.doc.content.size, table));
    expect(serializeToTypst(doc)).toBe('Text\n\n#table(\n  columns: 2,\n  [\\*], [],\n  [\\- no list], [x\\]],\n)\n');
    expectPreciseMap(doc);
  });

  it('syncs an outside change to a cell as a change in that cell', () => {
    const state = EditorState.create({ doc: parseTypst(source) });
    const changed = source.replace('[a]', '[ab]');
    const tr = applyTypstChanges(state.tr, parseTypst(changed));
    expect(serializeToTypst(tr.doc)).toBe(changed);
    expect(tr.doc.child(0).child(1)).toBe(state.doc.child(0).child(1));
    expectPreciseMap(tr.doc);
  });
});

const codeMark = (fence = 1, lang: string | null = null) => schema.marks.code.create({ fence, lang });
const codeOf = (node: Node) => node.marks.find((m) => m.type.name === 'code')?.attrs;

/**
 * The first block's content as runs of equally formatted text (atoms by type name), to compare a doc with the
 * parse of its print; how text is written in the source (`typstSource`) does not count.
 */
function markedText(doc: Node): [string, string[]][] {
  const result: [string, string[]][] = [];
  doc.child(0).forEach((child) => {
    const marks = child.marks.filter((m) => m.type.name !== 'typstSource').map((m) => m.type.name);
    const last = result.at(-1);
    if (child.isText && last && last[1].join() === marks.join() && last[0] !== '') last[0] += child.text;
    else result.push([child.text ?? '', child.isText ? marks : [child.type.name]]);
  });
  return result;
}

/** Edits the first block of `source`, then checks that the printed Typst reads back as the same text and marks. */
function editInline(source: string, change: (state: EditorState) => EditorState['tr']): string {
  const doc = edit(parseTypst(source), change);
  expect(markedText(parseTypst(serializeToTypst(doc)))).toEqual(markedText(doc));
  expectPreciseMap(doc);
  return serializeToTypst(doc);
}

describe('code blocks', () => {
  it('parses a fenced raw block as a code block with its language and text', () => {
    const block = parseTypst('```rust\nfn main() {}\n  x\n```\n').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.attrs.language).toBe('rust');
    expect(block.attrs.fence).toBe(3);
    expect(block.textContent).toBe('fn main() {}\n  x');
  });

  it('keeps longer fences and the backticks they enclose', () => {
    const block = parseTypst('````\na```b\n````').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.attrs.fence).toBe(4);
    expect(block.attrs.language).toBeNull();
    expect(block.textContent).toBe('a```b');
  });

  it('parses an empty code block', () => {
    const block = parseTypst('```py\n```').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.content.size).toBe(0);
  });

  it('keeps unclosed or embedded raw text unmodelled', () => {
    expect(parseTypst('```rust\nabc').child(0).type.name).toBe('rawBlock');
    const paragraph = parseTypst('Text ```\na\n``` more').child(0);
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.child(1).type.name).toBe('rawInline');
  });

  it('typing in a code block changes only its text', () => {
    const source = 'Intro\n\n```rust\nfn main() {}\n```\n';
    const doc = edit(parseTypst(source), (s) => s.tr.insertText('\n// done', after(s.doc, '{}')));
    expect(serializeToTypst(doc)).toBe('Intro\n\n```rust\nfn main() {}\n// done\n```\n');
    expectPreciseMap(doc);
  });

  it('changing the language re-prints the fence with the new tag', () => {
    const source = '```rust\nfn main() {}\n```\n';
    expect(serializeToTypst(edit(parseTypst(source), (s) => s.tr.setNodeAttribute(0, 'language', 'py')))).toBe('```py\nfn main() {}\n```\n');
    expect(serializeToTypst(edit(parseTypst(source), (s) => s.tr.setNodeAttribute(0, 'language', null)))).toBe('```\nfn main() {}\n```\n');
  });

  it('lengthens the fence when the text contains one', () => {
    const doc = edit(parseTypst('```\na\n```\n'), (s) => s.tr.insertText('\n````', after(s.doc, 'a')));
    expect(serializeToTypst(doc)).toBe('`````\na\n````\n`````\n');
    expect(parseTypst(serializeToTypst(doc)).child(0).textContent).toBe('a\n````');
  });

  it('shows a code block indented in a content block without the indentation, and prints it back indented', () => {
    const source = '#quote(block: true)[\n  ```typ\n  = Intro\n\n    #outline()\n  ```\n]\n';
    const doc = parseTypst(source);
    const block = doc.child(0).child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.textContent).toBe('= Intro\n\n  #outline()');
    expect(serializeToTypst(doc)).toBe(source);
    expectPreciseMap(doc);
    const edited = edit(doc, (s) => s.tr.insertText('\nText', after(s.doc, 'Intro')));
    expect(serializeToTypst(edited)).toBe(source.replace('= Intro\n', '= Intro\n  Text\n'));
    expectPreciseMap(edited);
    // a line less indented than the fence: shown as written
    const uneven = parseTypst('#quote(block: true)[\n  ```py\n  a\n b\n  ```\n]\n').child(0).child(0);
    expect([uneven.attrs.indent, uneven.textContent]).toEqual([null, ' a\n b']);
  });

  it('prints a code block created in the editor', () => {
    const block = schema.nodes.codeBlock.create({ language: 'js' }, schema.text('let a = `*`;\nb'));
    const doc = edit(parseTypst('Text\n'), (s) => s.tr.insert(s.doc.content.size, block));
    expect(serializeToTypst(doc)).toBe('Text\n\n```js\nlet a = `*`;\nb\n```\n');
    expectPreciseMap(doc);
    const empty = edit(parseTypst('Text\n'), (s) => s.tr.insert(s.doc.content.size, schema.nodes.codeBlock.create()));
    expect(serializeToTypst(empty)).toBe('Text\n\n```\n\n```\n');
    expect(parseTypst(serializeToTypst(empty)).child(1).type.name).toBe('codeBlock');
  });

});

describe('inline code', () => {
  it('parses inline raw text as text with a code mark', () => {
    const paragraph = parseTypst('Use `a*b` or ```js x()``` here').child(0);
    expect(paragraph.textContent).toBe('Use a*b or x() here');
    expect(paragraph.child(1).text).toBe('a*b');
    expect(codeOf(paragraph.child(1))).toEqual({ fence: 1, lang: null });
    expect(paragraph.child(3).text).toBe('x()');
    expect(codeOf(paragraph.child(3))).toEqual({ fence: 3, lang: 'js' });
  });

  it('parses a line of only inline code as a paragraph', () => {
    const paragraph = parseTypst('`x`').child(0);
    expect(paragraph.type.name).toBe('paragraph');
    expect(codeOf(paragraph.child(0))).toEqual({ fence: 1, lang: null });
  });

  it('keeps empty and multi-line inline raw as raw inlines', () => {
    for (const src of ['``', '`a\nb`', '```abc```']) {
      expect(parseTypst(`A ${src} b`).child(0).child(1).type.name, src).toBe('rawInline');
    }
  });

  it('typing inside inline code keeps the code and its delimiters', () => {
    expect(editInline('Use `ab` and ```js x``` now\n', (s) => s.tr.insertText('*', after(s.doc, 'a')).insertText('y', after(s.doc, 'x') + 1)))
      .toBe('Use `a*b` and ```js xy``` now\n');
  });

  it('marking text as code prints it in backticks, unescaped', () => {
    expect(editInline('Hello \\*x\\* \\#y\n', (s) => s.tr.addMark(1, s.doc.child(0).content.size + 1, codeMark()))).toBe('`Hello *x* #y`\n');
    expect(editInline('A #emph[b] c\n', (s) => s.tr.addMark(1, s.doc.child(0).content.size + 1, codeMark()))).toBe('`A `#emph[b]` c`\n');
  });

  it('uses a longer fence for code containing backticks', () => {
    expect(editInline('a\\`b\n', (s) => s.tr.addMark(1, 4, codeMark()))).toBe('``` a`b```\n');
    expect(editInline('ab\\`\n', (s) => s.tr.addMark(1, 4, codeMark()))).toBe('``` ab` ```\n');
    expect(editInline('a\\`\\`\\`b\n', (s) => s.tr.addMark(1, 6, codeMark()))).toBe('```` a```b````\n');
  });

  it('keeps code inside other formatting, never formatting inside code', () => {
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, codeMark()).addMark(7, 12, schema.marks.bold.create())))
      .toBe('Hello *`world`*\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, codeMark()).addMark(7, 10, schema.marks.bold.create())))
      .toBe('Hello *`wor`*`ld`\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, codeMark()).addMark(9, 12, schema.marks.italic.create())))
      .toBe('Hello `wo`_`rld`_\n');
  });

  it('removing the code mark escapes the text again', () => {
    const doc = edit(parseTypst('Use `*x*` now\n'), (s) => s.tr.removeMark(0, s.doc.content.size, schema.marks.code));
    expect(serializeToTypst(doc)).toBe('Use \\*x\\* now\n');
    expect(parseTypst(serializeToTypst(doc)).textContent).toBe('Use *x* now');
  });
});

describe('underline', () => {
  const marksOf = (node: Node) => node.marks.map((m) => m.type.name);

  it('parses #underline[..] as text with an underline mark, nesting with other marks', () => {
    const paragraph = parseTypst('A #underline[b *c*] and *#underline[d]* and #link("https://a.org")[#underline[e]]').child(0);
    expect(paragraph.textContent).toBe('A b c and d and e');
    expect(marksOf(paragraph.child(1))).toEqual(['underline']);
    expect(marksOf(paragraph.child(2))).toEqual(['bold', 'underline']);
    expect(marksOf(paragraph.child(4))).toEqual(['bold', 'underline']);
    expect(marksOf(paragraph.child(6))).toEqual(['link', 'underline']);
  });

  it('keeps underline calls with arguments, parentheses or no text as raw inlines', () => {
    for (const src of ['#underline(stroke: red)[a]', '#underline(offset: 2pt)[a]', '#underline()[a]', '#underline([a])', '#underline[]', '#underline[a][b]']) {
      expect(parseTypst(`A ${src} b`).child(0).child(1).type.name, src).toBe('rawInline');
    }
  });

  it('typing inside underlined text keeps the call', () => {
    expect(editInline('A #underline[ab] *#underline[cd]* c\n', (s) => s.tr.insertText('X', after(s.doc, 'a')).insertText('Y', after(s.doc, 'c') + 1)))
      .toBe('A #underline[aXb] *#underline[cYd]* c\n');
  });

  it('underlining text prints #underline[..], inside bold over the same span, around shorter formatting', () => {
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, schema.marks.underline.create()))).toBe('Hello #underline[world]\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, schema.marks.underline.create()).addMark(7, 12, schema.marks.bold.create())))
      .toBe('Hello *#underline[world]*\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(1, 12, schema.marks.underline.create()).addMark(7, 12, schema.marks.italic.create())))
      .toBe('#underline[Hello _world_]\n');
  });

  it('removing the underline leaves plain text', () => {
    const doc = edit(parseTypst('A #underline[*b*] c\n'), (s) => s.tr.removeMark(0, s.doc.content.size, schema.marks.underline));
    expect(serializeToTypst(doc)).toBe('A *b* c\n');
  });
});

describe('strike and highlight', () => {
  const marksOf = (node: Node) => node.marks.map((m) => m.type.name);

  it('parse #strike[..] and #highlight[..] as marks, nested inside bold, italic and underline', () => {
    const paragraph = parseTypst('A #strike[b] #highlight[c] *#underline[#highlight[#strike[d]]]*').child(0);
    expect(paragraph.textContent).toBe('A b c d');
    expect(marksOf(paragraph.child(1))).toEqual(['strike']);
    expect(marksOf(paragraph.child(3))).toEqual(['highlight']);
    expect(marksOf(paragraph.child(5))).toEqual(['bold', 'underline', 'strike', 'highlight']);
  });

  it('keep calls with arguments, parentheses or no text as raw inlines', () => {
    for (const src of ['#strike(stroke: red)[a]', '#strike(offset: 2pt)[a]', '#strike()[a]', '#strike([a])', '#strike[]', '#strike[a][b]',
      '#highlight(fill: red)[a]', '#highlight(radius: 2pt)[a]', '#highlight()[a]', '#highlight([a])', '#highlight[]', '#highlight[a][b]']) {
      expect(parseTypst(`A ${src} b`).child(0).child(1).type.name, src).toBe('rawInline');
    }
  });

  it('typing inside keeps the calls as written', () => {
    expect(editInline('A #strike[ab] #highlight[cd] c\n', (s) => s.tr.insertText('X', after(s.doc, 'a')).insertText('Y', after(s.doc, 'c') + 1)))
      .toBe('A #strike[aXb] #highlight[cYd] c\n');
  });

  it('formatting text prints them in the nesting order bold, italic, underline, strike, highlight', () => {
    const { bold, italic, underline, strike, highlight } = schema.marks;
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, strike.create()))).toBe('Hello #strike[world]\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(7, 12, highlight.create()))).toBe('Hello #highlight[world]\n');
    expect(editInline('Hello world\n', (s) => [highlight, strike, underline, italic, bold].reduce((tr, mark) => tr.addMark(7, 12, mark.create()), s.tr)))
      .toBe('Hello *_#underline[#strike[#highlight[world]]]_*\n');
    expect(editInline('Hello world\n', (s) => s.tr.addMark(1, 12, highlight.create()).addMark(7, 12, strike.create())))
      .toBe('#highlight[Hello #strike[world]]\n');
  });

  it('removing the mark leaves plain text', () => {
    const doc = edit(parseTypst('A #strike[*b*] #highlight[c] d\n'), (s) =>
      s.tr.removeMark(0, s.doc.content.size, schema.marks.strike).removeMark(0, s.doc.content.size, schema.marks.highlight));
    expect(serializeToTypst(doc)).toBe('A *b* c d\n');
  });
});

describe('table of contents', () => {
  it('parses a standalone #outline call as an outline block', () => {
    const doc = parseTypst('#outline()\n\n#outline(title: [Contents], depth: 2)\n\nText #outline()\n\n#outline\n');
    expect(doc.child(0).type.name).toBe('outline');
    expect(doc.child(0).attrs.src).toBe('#outline()');
    expect(doc.child(1).type.name).toBe('outline');
    expect(doc.child(1).attrs.src).toBe('#outline(title: [Contents], depth: 2)');
    expect(doc.child(2).child(1).type.name).toBe('rawInline');
    expect(doc.child(3).type.name).toBe('rawBlock');
  });

  it('prints an outline created in the editor', () => {
    const doc = edit(parseTypst('= Intro\n'), (s) => s.tr.insert(0, schema.nodes.outline.create({ src: '#outline()' })));
    expect(serializeToTypst(doc)).toBe('#outline()\n\n= Intro\n');
    expectPreciseMap(doc);
  });
});

describe('figures', () => {
  const source = '#figure(image("x.png", width: 50%), caption: [Some *caption*]) <fig:x>\n\nAfter\n';

  it('parses an image figure as the image and its caption as rich text', () => {
    const figure = parseTypst(source).child(0);
    expect(figure.type.name).toBe('figure');
    expect(figure.child(0).type.name).toBe('image');
    expect(figure.child(0).attrs.src).toBe('image("x.png", width: 50%)');
    const caption = figure.child(1);
    expect(caption.type.name).toBe('figureCaption');
    expect(caption.textContent).toBe('Some caption');
    expect(caption.child(1).marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('parses figures without a caption, with other arguments and inside table cells', () => {
    const doc = parseTypst(FIXTURES.figures);
    expect(doc.child(1).type.name).toBe('figure');
    expect(doc.child(1).child(1).textContent).toBe('With a link and code'); // `code` is code-marked text
    expect(doc.child(2).childCount).toBe(1);
    expect(doc.child(3).child(1).content.size).toBe(0);
    expect(doc.child(4).child(0).child(0).child(0).type.name).toBe('figure');
  });

  it('keeps figures it cannot model raw', () => {
    parseTypst(FIXTURES.rawFigures).forEach((block) => expect(block.type.name, block.attrs.src).toBe('rawBlock'));
  });

  it('editing the caption changes only the caption', () => {
    const doc = edit(parseTypst(source), (s) => s.tr.insertText(' text', after(s.doc, 'caption')));
    expect(serializeToTypst(doc)).toBe(source.replace('[Some *caption*]', '[Some *caption text*]'));
    expectPreciseMap(doc);
  });

  it('typed caption text is escaped for a content block', () => {
    const doc = edit(parseTypst('#figure(image("c.png"), caption: [])\n'), (s) => s.tr.insertText('- a] b', insideEmptyBlock(s.doc)));
    expect(serializeToTypst(doc)).toBe('#figure(image("c.png"), caption: [\\- a\\] b])\n');
  });

  it('editing the image call changes only the image call', () => {
    const doc = edit(parseTypst(source), (s) => s.tr.setNodeAttribute(1, 'src', 'image("x.png", width: 30%)'));
    expect(serializeToTypst(doc)).toBe(source.replace('50%', '30%'));
  });

  it('adding a caption to a figure without one puts it right after the image', () => {
    const text = '#figure(\n  image("b.png"),\n  placement: top,\n) <b>\n';
    const doc = edit(parseTypst(text), (s) => {
      const image = s.doc.child(0).child(0);
      return s.tr.insert(1 + image.nodeSize, schema.nodes.figureCaption.create(null, schema.text('Hi')));
    });
    expect(serializeToTypst(doc)).toBe('#figure(\n  image("b.png"), caption: [Hi],\n  placement: top,\n) <b>\n');
    expectPreciseMap(doc);
  });

  it('removing a caption removes just its argument', () => {
    for (const [text, expected] of [
      ['#figure(image("a.png"), caption: [x], placement: top) <a>\n', '#figure(image("a.png"), placement: top) <a>\n'],
      ['#figure(image("a.png"), placement: top, caption: [x])\n', '#figure(image("a.png"), placement: top)\n'],
      ['#figure(\n  image("a.png"),\n  caption: [x],\n)\n', '#figure(\n  image("a.png"),\n)\n'],
    ]) {
      const doc = edit(parseTypst(text), (s) => {
        const figure = s.doc.child(0);
        return s.tr.delete(1 + figure.child(0).nodeSize, figure.nodeSize - 1);
      });
      expect(serializeToTypst(doc), text).toBe(expected);
    }
  });

  it('prints a figure created in the editor', () => {
    const figure = schema.nodes.figure.create(null, [
      schema.nodes.image.create({ src: 'image("a.png", width: 50%)' }),
      schema.nodes.figureCaption.create(null, [schema.text('A '), schema.text('cat', [schema.marks.italic.create()])]),
    ]);
    const doc = edit(parseTypst('Text\n'), (s) => s.tr.insert(s.doc.content.size, figure));
    expect(serializeToTypst(doc)).toBe('Text\n\n#figure(image("a.png", width: 50%), caption: [A _cat_])\n');
    expectPreciseMap(doc);
  });

  it('syncs an outside change to the caption as a change in the caption', () => {
    const state = EditorState.create({ doc: parseTypst(source) });
    const changed = source.replace('Some', 'Any');
    const tr = applyTypstChanges(state.tr, parseTypst(changed));
    expect(serializeToTypst(tr.doc)).toBe(changed);
    expect(tr.doc.child(0).child(0)).toBe(state.doc.child(0).child(0));
  });

});

describe('the order of the built-in extensions', () => {
  // Registration order carries no meaning: where contributions compete (task lists and bullet lists claim `- ..`,
  // the image and snippet renderers draw raw boxes), their priority decides.
  const reversed = schemaOf([...builtins()].reverse());

  for (const [name, source] of Object.entries(FIXTURES)) {
    it(`does not change how ${name} parses and prints`, () => {
      const doc = parseTypst(source, reversed);
      expect(doc.toJSON()).toEqual(parseTypst(source).toJSON());
      expect(serializeToTypst(doc)).toBe(source);
    });
  }
});
