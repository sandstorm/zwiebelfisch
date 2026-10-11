// What the outline extension contributes to the Visual view: `#outline(..)` as a box headed "Table of contents",
// and "Insert" → "Table of contents". See outline.ts.
import { Node } from '@tiptap/core';
import { hasOnlyArguments, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ToolbarAction, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';

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
    return ['pre', { class: 'typst-outline__box' }, node.attrs.src];
  },
});

/**
 * A standalone `#outline(..)` call: the table of contents. Its source is kept
 * and edited like a raw block's; the box is headed "Table of contents" and
 * shows the compiled outline where a box renderer draws it.
 */
export const OUTLINE: TypstNodeSpec = {
  name: 'outline',
  tiptap: Outline,
  typst: {
    parseTypst: { calls: { outline: { block: (p, call, sep) => (hasOnlyArguments(call) ? p.schema.nodes.outline.create({ src: p.text(withHash(call)), sep }) : null) } } },
    labelled: true,
  },
  view: { box: 'code', title: { className: 'typst-outline__box', text: () => 'Table of contents' } },
};

const ICON = svg('<path d="M4 6h10M7 10h13M7 14h13M4 18h10"/>');

/** "Table of contents" in the Insert menu: an `#outline()` block. */
export const INSERT_OUTLINE: ToolbarAction = { label: 'Table of contents', icon: ICON, run: (c) => c.insertContent({ type: 'outline', attrs: { src: '#outline()' } }) };
