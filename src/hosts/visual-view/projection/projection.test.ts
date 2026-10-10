// Tests for projection.ts: the framework with the host's own nodes (paragraphs, text, raw Typst) and specs defined
// here. The built-in extensions' specs are tested together in typst-editor/typst-editor.projection.test.ts.
import { Node as TiptapNode } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createSchema, starterKitPart } from '../nodes/nodes';
import { children, parenthesized, posToSource, print, project as projectWith, sourceToPos, type MarkGrammar, type NodeGrammar } from './projection';

/** `*x*` as a bold mark: hidden syntax around visible text. */
const STRONG: MarkGrammar = {
  name: 'bold',
  extension: starterKitPart('testBold', { bold: {} }),
  inlineSyntax: { Strong: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) },
  print: () => ({ open: '*', close: '*' }),
};

/** `#divider(..)` as a block atom keeping its source, which a label may follow. */
const DIVIDER: NodeGrammar = {
  name: 'divider',
  extension: TiptapNode.create({
    name: 'divider',
    group: 'block',
    atom: true,
    addAttributes: () => ({ src: { default: '#divider()', rendered: false }, sep: { default: null, rendered: false } }),
    renderHTML: () => ['hr'],
  }),
  labelled: true,
  blockCalls: { divider: (p, call, sep) => (parenthesized(call.args) ? p.schema.nodes.divider.create({ src: p.text(call), sep }) : null) },
};

const hostOnly = createSchema([], []);
const withSpecs = createSchema([DIVIDER], [STRONG]);

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

const SOURCES: Record<string, string> = {
  empty: '',
  paragraphs: 'First paragraph\ncontinues here.\n\n\nSecond   paragraph.\n',
  unmodelled: '= Title <intro>\n\n#set text(lang: "de")\n\nSome *bold* and #emph[x] text, $x^2$.\n\n- a list\n',
  breaks: 'Line one \\\nline two -- dash...\n',
  broken: '#set page(\n\n*unclosed\n',
  specs: 'Some *bold* text\n\n#divider() <d>\n\n#divider(weak: true)\n\n#divider\n',
};

describe('projection framework', () => {
  describe('round-trips byte for byte', () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      it(`${name}, with the host's nodes only`, () => expect(print(projectWith(source, hostOnly))).toBe(source));
      it(`${name}, with specs`, () => expect(print(projectWith(source, withSpecs))).toBe(source));
    }
  });

  it("keeps what no spec models as raw blocks and raw inlines (the host's fallback)", () => {
    const doc = projectWith('= Title\n\nSome *bold* text\n', hostOnly);
    expect(doc.child(0).type.name).toBe('rawBlock');
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('Some  text');
    expect(doc.child(1).child(1).type.name).toBe('rawInline');
    expect(doc.child(1).child(1).attrs.src).toBe('*bold*');
  });

  it("projects a spec's syntax and calls into its node and mark, with the label after the block", () => {
    const doc = projectWith('Some *bold* text\n\n#divider() <d>\n', withSpecs);
    expect(doc.child(0).textContent).toBe('Some bold text');
    expect(doc.child(0).child(1).marks.map((m) => m.type.name)).toEqual(['bold']);
    expect(doc.child(1).type.name).toBe('divider');
    expect(doc.child(1).attrs.label).toMatchObject({ name: 'd' });
  });

  it("prints a mark added in the editor with its spec's syntax, changing only that block", () => {
    const source = '#set text(lang: "en")\n\nSales  were\n_good_.\n\nOther -- text\n';
    const doc = edit(projectWith(source, withSpecs), (s) => {
      const to = after(s.doc, 'Other');
      return s.tr.addMark(to - 'Other'.length, to, withSpecs.marks.bold.create());
    });
    expect(print(doc)).toBe(source.replace('Other', '*Other*'));
  });

  it('snaps hidden syntax to the next visible position', () => {
    const source = 'An *important* point';
    const doc = projectWith(source, withSpecs);
    const bold = after(doc, 'important') - 'important'.length;
    expect(sourceToPos(doc, source.indexOf('*'))).toBe(bold);
    expect(posToSource(doc, bold)).toBe(source.indexOf('important'));
    expect(sourceToPos(doc, source.lastIndexOf('*'))).toBe(after(doc, 'important'));
  });
});
