// The horizontal rule: a full-width `#line(length: 100%)` shown as a rule, "Horizontal rule" and `---`.
// See pageLayout in ../page-layout.ts.
import type { SyntaxNode } from '@lezer/common';
import { InputRule, Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { callArguments, hasOnlyArguments, namedArgument, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type TypstNodeSpec } from '../../../hosts/visual-editor/visual-editor';
import type { TypstParseContext } from '../../../hosts/prosemirror-typst/prosemirror-typst';

/**
 * The rule node. Its input rule only fires when the typed characters are all
 * of an empty paragraph: in Typst markup `---` is an em dash, so typing it
 * inside text must stay text.
 */
const HorizontalRule = Node.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#line(length: 100%)', rendered: false }, sep: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'hr' }];
  },
  renderHTML() {
    return ['div', { 'data-type': 'horizontal-rule', class: 'typst-page-layout__rule' }, ['hr']];
  },
  addCommands() {
    return { setHorizontalRule: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addInputRules() {
    return [
      new InputRule({
        find: RULE_INPUT,
        handler: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const paragraph = $from.parent;
          const whole = range.from === $from.start() && range.to === $from.end();
          const container = $from.node(-1);
          const index = $from.index(-1);
          if (paragraph.type.name !== 'paragraph' || !whole || !container.canReplaceWith(index, index + 1, this.type)) return null;
          const rule = this.type.create();
          const after = state.schema.nodes.paragraph.create();
          state.tr.replaceWith($from.before(), $from.after(), [rule, after]);
          state.tr.setSelection(TextSelection.create(state.tr.doc, $from.before() + rule.nodeSize + 1));
        },
      }),
    ];
  },
});

/**
 * `#line(length: 100%, ..)`: a line across the full width, shown as a rule
 * (a fixed widget). Only named arguments, and none that position or turn it
 * (`start`, `end`, `angle`); `stroke` and the like are kept. Any other line
 * stays raw. Its source is kept verbatim.
 */
export const HORIZONTAL_RULE: TypstNodeSpec = {
  name: 'horizontalRule',
  tiptap: HorizontalRule,
  typst: {
    parseTypst: {
      calls: {
        line: {
          block: (p, call, sep) =>
            hasOnlyArguments(call) && isFullWidthLine(p, call) ? p.schema.nodes.horizontalRule.create({ src: p.text(withHash(call)), sep }) : null,
        },
      },
    },
    labelled: true,
  },
};

const ICON = svg('<path d="M3 12h18"/>');

/** "Horizontal rule" in the Insert menu. */
export const INSERT_HORIZONTAL_RULE: ToolbarAction = { label: 'Horizontal rule', icon: ICON, keywords: ['line', 'divider', 'separator'], run: (c) => c.setHorizontalRule() };

/** `---` (or `—-`, as some systems autocorrect it), `___ ` or `*** `: Markdown's rules, as in Tiptap. */
const RULE_INPUT = /^(?:---|—-|___\s|\*\*\*\s)$/;

/** Named arguments only, `length: 100%` among them and none of `POSITIONING`. */
function isFullWidthLine(p: TypstParseContext, call: SyntaxNode): boolean {
  const named = callArguments(call).every((arg) => arg.name === 'Named' && !POSITIONING.has(p.text(arg.firstChild!)));
  const length = namedArgument(call, 'length', p.source);
  return named && length !== null && p.text(length) === '100%';
}

const POSITIONING = new Set(['start', 'end', 'angle']);

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    horizontalRule: {
      /** Inserts `#line(length: 100%)` as a block of its own at the selection. */
      setHorizontalRule: () => ReturnType;
    };
  }
}
