// @vitest-environment jsdom
// Tests for the public Visual-editor contribution API (index.ts): the example construct of
// docs/40_architecture/04_visual-editor.typ, a `#callout(title: "…")[…]` box with a title field, written as if
// outside the package — it imports only the package entry (and Tiptap, Lezer's types) — and run in a Visual editor with the built-ins.
import type { SyntaxNode } from '@lezer/common';
import { Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from './core/typst-document/typst-document';
import {
  callArguments, decodeString, namedArgument, quote, trailingContent, withHash,
  type ToolbarItem, type Extension, type TypstNodeSpec, type TypstParseContext, type TypstSerializeState,
} from './index';
import { createVisualEditor } from './testing/testing';

// ----- the example, as in docs/40_architecture/04_visual-editor.typ (there it imports from 'zwiebelfisch') -----

/** How a callout's source lies around its blocks (`#callout(title: "Tip")[` and `]`), and the title written there. */
interface CalloutLayout {
  open: string;
  close: string;
  title: string;
}

/** The node: blocks in a box whose title is a field of its own. */
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  // `sep` (the whitespace after the callout's source) and `layout` (how it was written) keep its source: never rendered
  addAttributes: () => ({ title: { default: 'Note', rendered: false }, sep: { default: null, rendered: false }, layout: { default: null, rendered: false } }),
  renderHTML: () => ['aside', { class: 'callout' }, ['div', 0]],
  addNodeView: () => ({ node, getPos, editor }) => {
    const doc = editor.view.dom.ownerDocument;
    const dom = doc.createElement('aside');
    dom.className = 'callout';
    const header = dom.appendChild(doc.createElement('div'));
    header.contentEditable = 'false';
    const title = header.appendChild(doc.createElement('input'));
    title.setAttribute('aria-label', 'Callout title');
    title.value = node.attrs.title;
    title.addEventListener('change', () => {
      const pos = getPos();
      if (pos !== undefined) editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'title', title.value));
    });
    const contentDOM = dom.appendChild(doc.createElement('div'));
    return {
      dom,
      contentDOM,
      update: (next: ProseMirrorNode) => {
        if (next.type !== node.type) return false;
        if (title.value !== next.attrs.title) title.value = next.attrs.title;
        return true;
      },
      // the field is the box's, not the text's
      stopEvent: (event: Event) => header.contains(event.target as globalThis.Node),
      ignoreMutation: (mutation: { target: globalThis.Node }) => header.contains(mutation.target),
    };
  },
});

/** `#callout[..]` or `#callout(title: "plain string")[..]`, whose content is blocks; anything else stays raw Typst. */
function parseCallout(p: TypstParseContext, call: SyntaxNode, sep: string | null): ProseMirrorNode | null {
  const content = trailingContent(call);
  const title = calloutTitle(p, call);
  if (content?.length !== 1 || title === null) return null;
  const { content: blocks, from, to } = p.blocks(content[0]);
  const source = withHash(call);
  const layout: CalloutLayout = { open: p.text({ from: source.from, to: from }), close: p.text({ from: to, to: source.to }), title };
  return p.schema.nodes.callout.create({ title, sep, layout }, blocks);
}

/** The title of `(title: "…")` (no arguments: "Note"); null for other arguments. */
function calloutTitle(p: TypstParseContext, call: SyntaxNode): string | null {
  const args = callArguments(call);
  const title = namedArgument(call, 'title', p.source);
  if (args.length === 0) return 'Note';
  return args.length === 1 && title?.name === 'Str' ? decodeString(p.text(title)) : null;
}

/** As written while the title is; a new callout, or one with a changed title, gets the call written anew. */
function calloutToTypst(state: TypstSerializeState, callout: ProseMirrorNode, pos: number): void {
  const layout: CalloutLayout | null = callout.attrs.layout;
  const title: string = callout.attrs.title;
  state.hidden(layout?.title === title ? layout.open : `#callout(title: ${quote(title)})[`);
  state.blocks(callout, pos + 1, '\n\n');
  state.closing(layout?.close ?? ']');
}

const CALLOUT: TypstNodeSpec = {
  name: 'callout',
  tiptap: Callout,
  typst: { parseTypst: { calls: { callout: { block: parseCallout } } }, toTypst: calloutToTypst, anchors: ['layout'], labelled: true },
};

/** "Callout" in the Insert menu: the selected blocks into a callout. */
const INSERT_CALLOUT: ToolbarItem = {
  group: 'insert',
  order: 80,
  action: { label: 'Callout', icon: '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor"/></svg>', run: (c) => c.wrapIn('callout') },
};

const CSS = '.callout { border-left: 3px solid var(--te-accent); padding: 4px 12px; } .callout input { font-weight: 600; border: none; }';

export function callout(): Extension {
  return {
    id: 'callout',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(CSS), visualEditor.registerNode(CALLOUT), visualEditor.registerToolbarItem(INSERT_CALLOUT));
    },
  };
}

// ----- the tests -----

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc, { contributions: [callout()] });
  const box = () => parent.querySelector<HTMLElement>('aside.callout');
  const title = () => box()!.querySelector<HTMLInputElement>('input[aria-label="Callout title"]')!;
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { doc, view, box, title, button };
}

describe('a Visual-editor construct written against the package entry', () => {
  it('shows a callout as a box with its title in a field and its content as text', () => {
    const { box, title } = setup('#callout(title: "Tip")[Use *bold* sparingly.]\n');
    expect(title().value).toBe('Tip');
    expect(box()!.querySelector('p')?.textContent).toBe('Use bold sparingly.');
  });

  it('prints a changed title as one edit of the call, keeping the content as written', () => {
    const { doc, title } = setup('Intro\n\n#callout(title: "Tip")[Use *bold* sparingly.] <tip>\n');
    title().value = 'Warning';
    title().dispatchEvent(new Event('change'));
    expect(doc.text).toBe('Intro\n\n#callout(title: "Warning")[Use *bold* sparingly.] <tip>\n');
  });

  it('follows edits of the source, and leaves calls it does not model raw', () => {
    const { doc, box, title } = setup('#callout[Plain]\n');
    expect(title().value).toBe('Note');
    doc.setText('#callout(title: "New")[Plain]\n', 'source');
    expect(title().value).toBe('New');
    doc.setText('#callout(kind: "x")[Plain]\n', 'source');
    expect(box()).toBeNull();
  });

  it('wraps the selected paragraph from the Insert menu', () => {
    const { doc, view, button } = setup('Text\n');
    view.reveal(SourceRange.of({ from: 0, to: 4 }));
    button('Callout').click();
    expect(doc.text).toBe('#callout(title: "Note")[Text]\n');
  });
});
