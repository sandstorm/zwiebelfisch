// The Visual view's schema: its Tiptap extensions (nodes, marks, editing behaviour), and the node views of raw
// and rendered boxes. Entry of visual-view/nodes/. See ARCHITECTURE.md, "VisualView".
import { Extension, Mark, Node, getSchema } from '@tiptap/core';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView, NodeView } from '@tiptap/pm/view';
import Document from '@tiptap/extension-document';
import { ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { codeBlockView } from './code-block-view';
import { MarginNote, NoteRange } from './margin-notes';
import { HeadingNumbers } from './heading-numbers';
import { HorizontalRule } from './horizontal-rule';
import { PageBreak } from './page-break';
import { ChecklistPreamble, TypstTaskItem, TypstTaskList } from './task-list';
import { RawBoxNavigation, rawBoxView } from './raw-box';
import { Reference } from '../references/references';
import { TextAlign } from './text-align';
import { StyledBlock, StyleMark } from './styles';

export { hasHeadingNumbering } from './heading-numbering';
export { setBoxLinks, setBoxRenderer } from './raw-box';
export type { BoxRenderer, Snippet } from './rendered-box';
export { textAlignAt, type TextAlignment } from './text-align';
export type { AppliedStyle } from './styles';

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
 * - table and blockquote `layout`: how the source is laid out around their
 *   content (owned by the projection);
 * - code block `fence`: the backticks of its delimiters.
 *
 * `label` (`{ name, gap }` or null) is the label after a block (`= Intro
 * <intro>`): printed after it, shown as a tag (see `references/`).
 *
 * A block whose anchors change (as every re-projected block's `src` does
 * after an edit from elsewhere) keeps its DOM, so what is inside, like an
 * open note editor, survives; see `keepWhileRenderedSame`.
 */
const ANCHORED_BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem'];

/** Blocks a label can follow: whatever a segment of markup projects to (see projection.ts). */
const LABELLED_BLOCKS = [
  'paragraph', 'heading', 'codeBlock', 'rawBlock', 'image', 'outline', 'figure', 'table', 'blockquote', 'alignment', 'pageBreak', 'horizontalRule', 'styledBlock',
];

const SourceAnchors = Extension.create({
  name: 'typstSourceAnchors',
  addProseMirrorPlugins() {
    const views = Object.fromEntries(ANCHORED_BLOCKS.map((type) => [type, keepWhileRenderedSame]));
    return [new Plugin({ props: { nodeViews: views } })];
  },
  addGlobalAttributes() {
    return [
      {
        // code blocks have their own node view (code-block-view.ts), so they are anchored but not kept
        types: [...ANCHORED_BLOCKS, 'codeBlock'],
        attributes: {
          src: { default: null, rendered: false, keepOnSplit: false },
          sep: { default: null, rendered: false },
        },
      },
      { types: ['listItem'], attributes: { marker: { default: null, rendered: false } } },
      { types: ['codeBlock'], attributes: { fence: { default: 3, rendered: false } } },
      { types: ['table', 'blockquote'], attributes: { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } } },
      { types: ['hardBreak'], attributes: { src: { default: '\\\n', rendered: false, keepOnSplit: false } } },
      { types: LABELLED_BLOCKS, attributes: { label: { default: null, rendered: false, keepOnSplit: false } } },
    ];
  },
});

/**
 * The block as its schema renders it, kept (and its content updated in place)
 * while a new version renders the same. ProseMirror would rebuild it, and
 * everything inside, on any attribute change.
 */
function keepWhileRenderedSame(initial: PMNode, view: EditorView): NodeView {
  let node = initial;
  const render = (n: PMNode) => n.type.spec.toDOM!(n);
  const { dom, contentDOM } = DOMSerializer.renderSpec(view.dom.ownerDocument, render(node));
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== node.type || JSON.stringify(render(next)) !== JSON.stringify(render(node))) return false;
      node = next;
      return true;
    },
  };
}

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

/**
 * A standalone `#outline(..)` call: the table of contents. Its source is kept
 * and edited like a raw block's; the box is headed "Table of contents" and
 * shows the compiled outline when a renderer is set.
 */
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
  addNodeView() {
    return rawBoxView;
  },
});

/**
 * Raw text in a block (```lang …```): plain text edited in place, under a
 * field for its language.
 */
const TypstCodeBlock = CodeBlock.extend({
  addNodeView() {
    return codeBlockView;
  },
}).configure({ HTMLAttributes: { class: 'typst-visual__code-block' } });

/**
 * Inline raw text (`code`). Unlike Tiptap's code mark it combines with other
 * formatting (Typst allows `*`code`*`). `fence` and `lang` remember the
 * delimiters (```lang …```) so they print back as written.
 */
const TypstCode = Code.extend({
  excludes: '',
  addAttributes() {
    return { fence: { default: 1, rendered: false }, lang: { default: null, rendered: false } };
  },
}).configure({ HTMLAttributes: { class: 'typst-visual__code-inline' } });

/**
 * `#figure(image(..), caption: [..])`: the image (an `image` node holding
 * the call without its `#`) or a table (`table(..)`) and, optionally, the
 * caption as rich text. `layout` is how the figure's source lies around the
 * two (owned by the projection); other arguments and a label after the call
 * live there.
 */
const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: '(image | table) figureCaption?',
  isolating: true,
  addAttributes() {
    return { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } };
  },
  renderHTML() {
    return ['figure', { class: 'typst-visual__figure' }, 0];
  },
});

/** A figure's caption: one paragraph of rich text. Enter leaves the figure. */
const FigureCaption = Node.create({
  name: 'figureCaption',
  content: 'inline*',
  addAttributes() {
    return { src: { default: null, rendered: false } };
  },
  renderHTML() {
    return ['figcaption', { class: 'typst-visual__caption' }, 0];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.parent.type.name !== 'figureCaption') return false;
        const after = $from.after($from.depth - 1);
        return this.editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run();
      },
    };
  },
});

/**
 * Inline Typst the Visual view does not model (`#func[..]`, `$x$`, `<label>`, …), kept verbatim and editable as code.
 * `code`: `src` is written in code, without `#` (a table cell that is an expression, like `ms(18)`).
 */
const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: '', rendered: false }, code: { default: false, rendered: false } };
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
    blockquote: { HTMLAttributes: { class: 'typst-visual__quote' } },
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
  Outline,
  TypstCodeBlock,
  TypstCode,
  Figure,
  FigureCaption,
  PageBreak,
  HorizontalRule,
  TypstTaskList,
  TypstTaskItem,
  ChecklistPreamble,
  HeadingNumbers,
  TypstDocument,
  TypstListItem,
  SourceAnchors,
  RawBlock,
  RawInline,
  RawBoxNavigation,
  SoftBreak,
  TypstSource,
  TextAlign,
  MarginNote,
  NoteRange,
  Reference,
  StyledBlock,
  StyleMark,
];

/** The schema `extensions` produce; an `Editor` builds an equal but distinct instance. */
export const schema = getSchema(extensions);
