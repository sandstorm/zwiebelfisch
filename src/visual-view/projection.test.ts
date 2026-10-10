import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { schema } from './extensions';
import { codeLanguage, imagePath, imageSource, posToSource, print, project as projectWith, sourceToPos, syncDoc } from './projection';

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
  links: 'See #link("https://typst.app")[the *site*] or https://typst.app/docs.\n#link("x")[] #link(url)[a]\n',
  images: '#image("img/logo.png", width: 50%)\n\nText #image("i.png") inline\n',
  tables: '#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n)\n\n#table(columns: 1, [one\n\ntwo])\n',
  rawTables: '#table(columns: (1fr, 1fr), [a], [b])\n\n#table(columns: 2, [a], [b], [c])\n\n#table(columns: 1, table.header[H], [a])\n',
  code: 'Use `x` and ``` `y` ``` or ```js a``` *`b`*.\n\n```rust\nfn main() {}\n```\n\n````\na```b\n````\n\n```\n```\n\n`a\nb` ``\n',
  outline: '#outline()\n\n#outline(title: [Contents], depth: 2)\n\nText #outline() inline\n',
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
  it('projects #link("url")[text] and bare URLs as link marks over their text', () => {
    const doc = project('See #link("https://typst.app")[the *site*] or https://typst.app/docs.');
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
      const doc = project(`A ${src} b`);
      expect(doc.child(0).child(1).type.name, src).toBe('rawInline');
    }
  });

  it('re-prints an edited paragraph with its links intact', () => {
    const source = 'x #link("https://a.org")[*a* b] and https://b.org/x y\n';
    const doc = edit(project(source), (s) => s.tr.insertText('!', after(s.doc, ' y')));
    expect(print(doc)).toBe('x #link("https://a.org")[*a* b] and https://b.org/x y!\n');
  });

  it('typing inside link text keeps the link', () => {
    const doc = edit(project('#link("https://a.org")[site]\n'), (s) => s.tr.insertText('X', after(s.doc, 'si')));
    expect(print(doc)).toBe('#link("https://a.org")[siXte]\n');
  });

  it('adding a link to text prints #link, quoting the URL', () => {
    const doc = edit(project('Read the docs now\n'), (s) => {
      const to = after(s.doc, 'docs');
      return s.tr.addMark(to - 4, to, linkMark('https://x.org/?q="1"'));
    });
    expect(print(doc)).toBe('Read the #link("https://x.org/?q=\\"1\\"")[docs] now\n');
  });

  it('prints a link whose text is its URL as a bare URL, where Typst reads it back', () => {
    const url = 'https://typst.app/docs';
    // typed text, so the URL is not linked yet
    const linked = (source: string) =>
      edit(project(source), (s) => {
        const at = after(s.doc, 'See ');
        return s.tr.insertText(url, at).addMark(at, at + url.length, linkMark(url));
      });
    expect(print(linked('See  now\n'))).toBe(`See ${url} now\n`);
    expect(print(linked('See .\n'))).toBe(`See #link("${url}")[https:\\//typst.app/docs].\n`);
  });

  it('removing a link leaves plain text', () => {
    const doc = edit(project('A #link("https://a.org")[site] b\n'), (s) => {
      const to = after(s.doc, 'site');
      return s.tr.removeMark(to - 4, to, schema.marks.link);
    });
    expect(print(doc)).toBe('A site b\n');
  });

  it('escapes a parenthesis right after a function call, which would continue it', () => {
    const doc = edit(project('Hi\n'), (s) => s.tr.insertText('(note)', after(s.doc, 'Hi')).addMark(1, 3, linkMark('https://a.org')));
    expect(print(doc)).toBe('#link("https://a.org")[Hi]\\(note)\n');
  });

  it('keeps the position map precise around edited links', () => {
    const doc = edit(project('A #link("https://a.org")[site] and https://b.org b\n'), (s) => s.tr.insertText('!', after(s.doc, ' b')));
    expectPreciseMap(doc);
  });
});

describe('images', () => {
  it('projects a standalone #image call as an image block', () => {
    const doc = project('#image("img/logo.png", width: 50%)\n\nText #image("i.png")\n');
    expect(doc.child(0).type.name).toBe('image');
    expect(doc.child(0).attrs.src).toBe('#image("img/logo.png", width: 50%)');
    expect(doc.child(1).child(1).type.name).toBe('rawInline');
  });

  it('keeps other image calls raw', () => {
    for (const src of ['#image(path)', '#image("a.png") #image("b.png")', '#image("a.png").x']) {
      expect(project(src).child(0).type.name, src).not.toBe('image');
    }
  });

  it('prints an image created in the editor', () => {
    const doc = edit(project('Text\n'), (s) =>
      s.tr.insert(s.doc.content.size, schema.nodes.image.create({ src: imageSource('a "b".png') })),
    );
    expect(print(doc)).toBe('Text\n\n#image("a \\"b\\".png")\n');
    expectPreciseMap(doc);
  });

  it('reads the path of an image source', () => {
    expect(imagePath('#image("img/a.png", width: 50%)')).toBe('img/a.png');
    expect(imagePath('#image("a\\"b.png")')).toBe('a"b.png');
    expect(imagePath('#image(x)')).toBeNull();
  });
});

describe('tables', () => {
  const source = '#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n)\n';

  it('projects a table of content cells into rows and cells', () => {
    const table = project(source).child(0);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2);
    expect(table.child(0).childCount).toBe(2);
    expect(table.child(0).child(1).textContent).toBe('b c');
    expect(table.child(1).child(0).child(0).type.name).toBe('paragraph');
    expect(table.child(1).child(1).child(0).type.name).toBe('bulletList');
  });

  it('projects multi-paragraph cells as several blocks', () => {
    const cell = project('#table(columns: 1, [one\n\ntwo])').child(0).child(0).child(0);
    expect(cell.childCount).toBe(2);
  });

  it('keeps tables it cannot model raw', () => {
    for (const src of [
      '#table(columns: (1fr, 1fr), [a], [b])',
      '#table(columns: 2, [a], [b], [c])',
      '#table(columns: 1, table.header[H], [a])',
      '#table([a], [b])',
      '#table(columns: 1, [a]',
    ]) {
      expect(project(src).child(0).type.name, src).toBe('rawBlock');
    }
  });

  it('editing a cell changes only that cell', () => {
    const doc = edit(project(source), (s) => s.tr.insertText('!', after(s.doc, ' c')));
    expect(print(doc)).toBe(source.replace('*b* c]', '*b* c!]'));
    expectPreciseMap(doc);
  });

  it('typing into an empty cell fills its brackets', () => {
    const doc = edit(project(source), (s) => s.tr.insertText('new', insideEmptyBlock(s.doc)));
    expect(print(doc)).toBe(source.replace('[], [-', '[new], [-'));
  });

  it('re-prints a table whose shape changed, keeping its other arguments', () => {
    const doc = edit(project(source), (s) => {
      const table = s.doc.child(0);
      const row = schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, schema.text('e'))),
        schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
      ]);
      return s.tr.insert(table.nodeSize - 1, row);
    });
    expect(print(doc)).toBe('#table(\n  columns: 2,\n  stroke: none,\n  [a], [*b* c],\n  [], [- x\n  - y],\n  [e], [],\n)\n');
    expectPreciseMap(doc);
  });

  it('prints a table created in the editor', () => {
    const cell = (text?: string) => schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null));
    const table = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell('*'), cell()]),
      schema.nodes.tableRow.create(null, [cell('- no list'), cell('x]')]),
    ]);
    const doc = edit(project('Text\n'), (s) => s.tr.insert(s.doc.content.size, table));
    expect(print(doc)).toBe('Text\n\n#table(\n  columns: 2,\n  [\\*], [],\n  [\\- no list], [x\\]],\n)\n');
    expectPreciseMap(doc);
  });

  it('syncs an outside change to a cell as a change in that cell', () => {
    const state = EditorState.create({ doc: project(source) });
    const changed = source.replace('[a]', '[ab]');
    const tr = syncDoc(state.tr, project(changed));
    expect(print(tr.doc)).toBe(changed);
    expect(tr.doc.child(0).child(1)).toBe(state.doc.child(0).child(1));
    expectPreciseMap(tr.doc);
  });
});

const codeMark = (fence = 1, lang: string | null = null) => schema.marks.code.create({ fence, lang });
const codeOf = (node: Node) => node.marks.find((m) => m.type.name === 'code')?.attrs;

/**
 * The first block's content as runs of equally formatted text (atoms by type name), to compare a doc with the
 * projection of its print; how text is written in the source (`typstSource`) does not count.
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
  const doc = edit(project(source), change);
  expect(markedText(project(print(doc)))).toEqual(markedText(doc));
  expectPreciseMap(doc);
  return print(doc);
}

describe('code blocks', () => {
  it('projects a fenced raw block as a code block with its language and text', () => {
    const block = project('```rust\nfn main() {}\n  x\n```\n').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.attrs.language).toBe('rust');
    expect(block.attrs.fence).toBe(3);
    expect(block.textContent).toBe('fn main() {}\n  x');
  });

  it('keeps longer fences and the backticks they enclose', () => {
    const block = project('````\na```b\n````').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.attrs.fence).toBe(4);
    expect(block.attrs.language).toBeNull();
    expect(block.textContent).toBe('a```b');
  });

  it('projects an empty code block', () => {
    const block = project('```py\n```').child(0);
    expect(block.type.name).toBe('codeBlock');
    expect(block.content.size).toBe(0);
  });

  it('keeps unclosed or embedded raw text unmodelled', () => {
    expect(project('```rust\nabc').child(0).type.name).toBe('rawBlock');
    const paragraph = project('Text ```\na\n``` more').child(0);
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.child(1).type.name).toBe('rawInline');
  });

  it('typing in a code block changes only its text', () => {
    const source = 'Intro\n\n```rust\nfn main() {}\n```\n';
    const doc = edit(project(source), (s) => s.tr.insertText('\n// done', after(s.doc, '{}')));
    expect(print(doc)).toBe('Intro\n\n```rust\nfn main() {}\n// done\n```\n');
    expectPreciseMap(doc);
  });

  it('changing the language re-prints the fence with the new tag', () => {
    const source = '```rust\nfn main() {}\n```\n';
    expect(print(edit(project(source), (s) => s.tr.setNodeAttribute(0, 'language', 'py')))).toBe('```py\nfn main() {}\n```\n');
    expect(print(edit(project(source), (s) => s.tr.setNodeAttribute(0, 'language', null)))).toBe('```\nfn main() {}\n```\n');
  });

  it('lengthens the fence when the text contains one', () => {
    const doc = edit(project('```\na\n```\n'), (s) => s.tr.insertText('\n````', after(s.doc, 'a')));
    expect(print(doc)).toBe('`````\na\n````\n`````\n');
    expect(project(print(doc)).child(0).textContent).toBe('a\n````');
  });

  it('prints a code block created in the editor', () => {
    const block = schema.nodes.codeBlock.create({ language: 'js' }, schema.text('let a = `*`;\nb'));
    const doc = edit(project('Text\n'), (s) => s.tr.insert(s.doc.content.size, block));
    expect(print(doc)).toBe('Text\n\n```js\nlet a = `*`;\nb\n```\n');
    expectPreciseMap(doc);
    const empty = edit(project('Text\n'), (s) => s.tr.insert(s.doc.content.size, schema.nodes.codeBlock.create()));
    expect(print(empty)).toBe('Text\n\n```\n\n```\n');
    expect(project(print(empty)).child(1).type.name).toBe('codeBlock');
  });

  it('accepts only what Typst reads as a language tag', () => {
    expect(codeLanguage('rust')).toBe('rust');
    expect(codeLanguage('my-lang_2')).toBe('my-lang_2');
    expect(codeLanguage('c++')).toBe('c');
    expect(codeLanguage(' 1x')).toBe('');
  });
});

describe('inline code', () => {
  it('projects inline raw text as text with a code mark', () => {
    const paragraph = project('Use `a*b` or ```js x()``` here').child(0);
    expect(paragraph.textContent).toBe('Use a*b or x() here');
    expect(paragraph.child(1).text).toBe('a*b');
    expect(codeOf(paragraph.child(1))).toEqual({ fence: 1, lang: null });
    expect(paragraph.child(3).text).toBe('x()');
    expect(codeOf(paragraph.child(3))).toEqual({ fence: 3, lang: 'js' });
  });

  it('projects a line of only inline code as a paragraph', () => {
    const paragraph = project('`x`').child(0);
    expect(paragraph.type.name).toBe('paragraph');
    expect(codeOf(paragraph.child(0))).toEqual({ fence: 1, lang: null });
  });

  it('keeps empty and multi-line inline raw as raw inlines', () => {
    for (const src of ['``', '`a\nb`', '```abc```']) {
      expect(project(`A ${src} b`).child(0).child(1).type.name, src).toBe('rawInline');
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
    const doc = edit(project('Use `*x*` now\n'), (s) => s.tr.removeMark(0, s.doc.content.size, schema.marks.code));
    expect(print(doc)).toBe('Use \\*x\\* now\n');
    expect(project(print(doc)).textContent).toBe('Use *x* now');
  });
});

describe('table of contents', () => {
  it('projects a standalone #outline call as an outline block', () => {
    const doc = project('#outline()\n\n#outline(title: [Contents], depth: 2)\n\nText #outline()\n\n#outline\n');
    expect(doc.child(0).type.name).toBe('outline');
    expect(doc.child(0).attrs.src).toBe('#outline()');
    expect(doc.child(1).type.name).toBe('outline');
    expect(doc.child(1).attrs.src).toBe('#outline(title: [Contents], depth: 2)');
    expect(doc.child(2).child(1).type.name).toBe('rawInline');
    expect(doc.child(3).type.name).toBe('rawBlock');
  });

  it('prints an outline created in the editor', () => {
    const doc = edit(project('= Intro\n'), (s) => s.tr.insert(0, schema.nodes.outline.create({ src: '#outline()' })));
    expect(print(doc)).toBe('#outline()\n\n= Intro\n');
    expectPreciseMap(doc);
  });
});
