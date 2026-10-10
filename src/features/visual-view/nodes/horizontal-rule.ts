// The horizontal rule node: `#line(length: 100%)`. See nodes.ts.
import { InputRule, Node } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    horizontalRule: {
      /** Inserts `#line(length: 100%)` as a block of its own at the selection. */
      setHorizontalRule: () => ReturnType;
    };
  }
}

/** `---` (or `—-`, as some systems autocorrect it), `___ ` or `*** `: Markdown's rules, as in Tiptap. */
const RULE_INPUT = /^(?:---|—-|___\s|\*\*\*\s)$/;

/**
 * A full-width `#line(length: 100%, ..)` (see `callAtomType`), shown as a
 * rule. Its source is kept verbatim.
 *
 * The input rule only fires when the typed characters are all of an empty
 * paragraph: in Typst markup `---` is an em dash, so typing it inside text
 * must stay text.
 */
export const HorizontalRule = Node.create({
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
