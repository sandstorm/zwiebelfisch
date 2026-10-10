import { Extension, Mark, Node, getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { RawBoxNavigation, rawBoxView } from './raw-box';

/**
 * The Visual view's Tiptap extensions, i.e. its ProseMirror schema plus
 * editing behaviour (keymaps, input rules, list handling, undo).
 *
 * Source-anchoring attributes (never rendered; part of node equality, so
 * re-projections compare exactly):
 * - `src`: the node's original Typst source;
 * - `sep`: whitespace between this node and its next sibling — `null` on last
 *   children (the container owns trailing whitespace) and on nodes created in
 *   the editor (a default separator is printed);
 * - doc `lead`/`trail`: whitespace before the first / after the last block;
 * - table `layout`: how the table's source is laid out around its cells
 *   (owned by the projection).
 */
const SourceAnchors = Extension.create({
  name: 'typstSourceAnchors',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem'],
        attributes: {
          src: { default: null, rendered: false, keepOnSplit: false },
          sep: { default: null, rendered: false },
        },
      },
      { types: ['listItem'], attributes: { marker: { default: null, rendered: false } } },
      { types: ['table'], attributes: { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } } },
      { types: ['hardBreak'], attributes: { src: { default: '\\\n', rendered: false, keepOnSplit: false } } },
    ];
  },
});

const TypstDocument = Document.extend({
  addAttributes() {
    return { lead: { default: '', rendered: false }, trail: { default: '\n', rendered: false } };
  },
});

/** A list item's first child may be verbatim Typst (an item whose body the Visual view cannot model). */
const TypstListItem = ListItem.extend({ content: '(paragraph | rawBlock) block*' });

/**
 * Block-level Typst the Visual view does not model (`#set`, `#let`, display
 * math, figures, …), kept verbatim and editable as code in a raw box.
 */
const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: '', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'typst-visual__raw-block' }, node.attrs.src];
  },
  addNodeView() {
    return rawBoxView;
  },
});

/**
 * A standalone `#image("path", ..)` call. Its source is kept and edited like a
 * raw block's; the box shows which image it is.
 */
const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#image("")', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'typst-visual__image' }, node.attrs.src];
  },
  addNodeView() {
    return rawBoxView;
  },
});

/** Inline Typst the Visual view does not model (`#func[..]`, `$x$`, `@ref`, …), kept verbatim and editable as code. */
const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: '', rendered: false } };
  },
  renderHTML({ node }) {
    return ['code', { class: 'typst-visual__raw-inline' }, node.attrs.src];
  },
  addNodeView() {
    return rawBoxView;
  },
});

/** A newline inside a paragraph: renders as a space (as in Typst) but keeps the source's line structure. */
const SoftBreak = Node.create({
  name: 'softBreak',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { src: { default: '\n', rendered: false } };
  },
  renderHTML() {
    return ['span', { class: 'typst-visual__soft-break' }, ' '];
  },
});

/**
 * Text written differently in the source (an escape like `\*`, a shorthand
 * like `--`). Printed as `src` while the text still equals `text`; never
 * extends to newly typed text.
 */
const TypstSource = Mark.create({
  name: 'typstSource',
  inclusive: false,
  addAttributes() {
    return { src: { rendered: false }, text: { rendered: false } };
  },
  renderHTML() {
    return ['span', 0];
  },
});

export const extensions = [
  StarterKit.configure({
    document: false,
    listItem: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: { openOnClick: false, autolink: false, HTMLAttributes: { class: 'typst-visual__link', target: null, rel: null } },
    trailingNode: false,
  }),
  Table.configure({ resizable: false, HTMLAttributes: { class: 'typst-visual__table' } }),
  TableRow,
  TableCell,
  TableHeader,
  Image,
  TypstDocument,
  TypstListItem,
  SourceAnchors,
  RawBlock,
  RawInline,
  RawBoxNavigation,
  SoftBreak,
  TypstSource,
];

/** The schema `extensions` produce; an `Editor` builds an equal but distinct instance. */
export const schema = getSchema(extensions);
