// The horizontal rule: a full-width `#line(length: 100%)` shown as a rule, "Horizontal rule" and `---`.
// See builtins.ts.
import type { SyntaxNode } from '@lezer/common';
import { InputRule, Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { svg, type TypstNodeSpec, type VisualViewContribution } from '../contributions/contributions';
import { parenthesized, type ProjectionContext } from '../projection/projection';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    horizontalRule: {
      /** Inserts `#line(length: 100%)` as a block of its own at the selection. */
      setHorizontalRule: () => ReturnType;
    };
  }
}

/**
 * `#line(length: 100%, ..)`: a line across the full width, shown as a rule
 * (a fixed widget). Only named arguments, and none that position or turn it
 * (`start`, `end`, `angle`); `stroke` and the like are kept. Any other line
 * stays raw. Its source is kept verbatim.
 */
export const horizontalRule: VisualViewContribution = {
  id: 'horizontal-rule',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(RULE),
      visualView.registerToolbarItem({ group: 'insert', order: 70, action: { label: 'Horizontal rule', icon: ICON, run: (c) => c.setHorizontalRule() } }),
    );
  },
};

/** `---` (or `—-`, as some systems autocorrect it), `___ ` or `*** `: Markdown's rules, as in Tiptap. */
const RULE_INPUT = /^(?:---|—-|___\s|\*\*\*\s)$/;

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
    return ['div', { 'data-type': 'horizontal-rule', class: 'typst-visual__rule' }, ['hr']];
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

const RULE: TypstNodeSpec = {
  name: 'horizontalRule',
  extension: HorizontalRule,
  labelled: true,
  blockCalls: {
    line: (p, call, sep) =>
      parenthesized(call.args) && isFullWidthLine(p, call.args.slice(1, -1)) ? p.schema.nodes.horizontalRule.create({ src: p.text(call), sep }) : null,
  },
};

const POSITIONING = new Set(['start', 'end', 'angle']);

function isFullWidthLine(p: ProjectionContext, args: SyntaxNode[]): boolean {
  let fullWidth = false;
  for (const arg of args) {
    if (arg.name === 'Space' || arg.name === 'Comma') continue;
    const name = arg.name === 'Named' ? arg.getChild('Ident') : null;
    if (!name || POSITIONING.has(p.text(name))) return false;
    if (p.text(name) === 'length') fullWidth = p.text(arg.lastChild!) === '100%';
  }
  return fullWidth;
}

const ICON = svg('<path d="M3 12h18"/>');
