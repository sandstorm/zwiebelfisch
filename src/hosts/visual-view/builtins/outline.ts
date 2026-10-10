// The table of contents: `#outline(..)` as a box headed "Table of contents", and "Insert" → "Table of contents".
// See builtins.ts.
import { Node } from '@tiptap/core';
import { svg, type TypstNodeSpec, type VisualViewContribution } from '../contributions/contributions';
import { parenthesized } from '../projection/projection';

/**
 * A standalone `#outline(..)` call: the table of contents. Its source is kept
 * and edited like a raw block's; the box is headed "Table of contents" and
 * shows the compiled outline where a box renderer draws it.
 */
export const outline: VisualViewContribution = {
  id: 'outline',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(OUTLINE),
      visualView.registerToolbarItem({
        group: 'insert',
        order: 30,
        action: { label: 'Table of contents', icon: ICON, run: (c) => c.insertContent({ type: 'outline', attrs: { src: '#outline()' } }) },
      }),
    );
  },
};

const Outline = Node.create({
  name: 'outline',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#outline()', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'typst-visual__outline' }, node.attrs.src];
  },
});

const OUTLINE: TypstNodeSpec = {
  name: 'outline',
  extension: Outline,
  labelled: true,
  box: 'code',
  codeBox: { label: { className: 'typst-visual__outline', text: () => 'Table of contents' } },
  blockCalls: { outline: (p, call, sep) => (parenthesized(call.args) ? p.schema.nodes.outline.create({ src: p.text(call), sep }) : null) },
};

const ICON = svg('<path d="M4 6h10M7 10h13M7 14h13M4 18h10"/>');
