// What the figures extension contributes to the Visual editor. See ../figures.ts.
import type { SyntaxNode } from '@lezer/common';
import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';
import { callArguments, children, hasOnlyArguments, isClosedContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import type { TypstSerializeState, TypstParseContext } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import type { TypstNodeSpec } from '../../../hosts/visual-editor/visual-editor';

/** The node group of what a figure may hold as its body; a spec joins it with its node type's `group` (`block figureBody`). */
const FIGURE_BODY = 'figureBody';

/**
 * `#figure(image(..), caption: [..])`: the body (a node of group
 * `figureBody`: an image, its call without the `#`; a table, `table(..)`)
 * and, optionally, the caption as rich text. `layout` is how the figure's
 * source lies around the two (owned by the serializer); other arguments and
 * a label after the call live there.
 */
const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: `${FIGURE_BODY} figureCaption?`,
  isolating: true,
  addAttributes() {
    return { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } };
  },
  renderHTML() {
    return ['figure', { class: 'typst-figures__figure' }, 0];
  },
  addCommands() {
    return {
      addFigureCaption:
        (pos) =>
        ({ tr, dispatch }) =>
          addCaption(tr, pos, dispatch !== undefined),
      removeFigureCaption:
        (pos) =>
        ({ tr, dispatch }) =>
          removeCaption(tr, pos, dispatch !== undefined),
    };
  },
});

/**
 * Figures: read from `#figure(..)` calls, written around their body and caption.
 *
 * `#figure(body, caption: [..])` of a body any spec offers (`figureBody`: an image, a table), read with the caption as
 * rich text and printed back around their parts, and the commands that add and remove a caption.
 */
export const FIGURE: TypstNodeSpec = {
  name: 'figure',
  tiptap: Figure,
  typst: { parseTypst: { calls: { figure: { block: parseFigure } } }, toTypst: figureToTypst, anchors: ['layout'], labelled: true },
};

/** A figure's caption: one paragraph of rich text. Enter leaves the figure. */
const FigureCaption = Node.create({
  name: 'figureCaption',
  content: 'inline*',
  addAttributes() {
    return { src: { default: null, rendered: false } };
  },
  renderHTML() {
    return ['figcaption', { class: 'typst-figures__caption' }, 0];
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

export const FIGURE_CAPTION: TypstNodeSpec = { name: 'figureCaption', tiptap: FigureCaption };

/** `addFigureCaption` on `tr`, if it applies (`apply`: else only whether it would). */
function addCaption(tr: Transaction, pos: number, apply: boolean): boolean {
  const located = locate(tr, pos);
  if (!located || (located.figure && located.figure.node.childCount > 1)) return false;
  if (!apply) return true;
  const { schema } = tr.doc.type;
  const { body, figure } = located;
  if (figure) {
    tr.insert(pos + body.nodeSize, schema.nodes.figureCaption.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + body.nodeSize + 1));
  } else {
    // the body's label labels the figure now
    const inside = body.type.create({ ...body.attrs, src: asArgument(body.attrs.src), sep: null, label: null }, body.content, body.marks);
    const figureNode = schema.nodes.figure.create({ sep: body.attrs.sep, label: body.attrs.label ?? null }, [inside, schema.nodes.figureCaption.create()]);
    tr.replaceWith(pos, pos + body.nodeSize, figureNode);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + inside.nodeSize + 1));
  }
  tr.scrollIntoView();
  return true;
}

/** The figure body at `pos` and the figure around it (null: a bare block), if `pos` holds a figure body. */
function locate(tr: Transaction, pos: number): { body: PMNode; figure: { node: PMNode; pos: number } | null } | null {
  const body = tr.doc.nodeAt(pos);
  if (!body?.type.isInGroup(FIGURE_BODY)) return null;
  const $pos = tr.doc.resolve(pos);
  return { body, figure: $pos.parent.type.name === 'figure' ? { node: $pos.parent, pos: $pos.before() } : null };
}

/** A body's call (`src`, kept as source) as a figure's argument: without the `#` it has in markup. */
function asArgument(src: unknown): unknown {
  return typeof src === 'string' && src.startsWith('#') ? src.slice(1) : src;
}

/** `removeFigureCaption` on `tr`, if it applies (`apply`: else only whether it would). */
function removeCaption(tr: Transaction, pos: number, apply: boolean): boolean {
  const figure = locate(tr, pos)?.figure;
  if (!figure || figure.node.childCount < 2) return false;
  if (!apply) return true;
  const body = figure.node.child(0);
  if (hasFigureExtras(figure.node)) {
    tr.delete(pos + body.nodeSize, figure.pos + figure.node.nodeSize - 1);
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  } else {
    const bare = body.type.create({ ...body.attrs, src: asMarkup(body.attrs.src), sep: figure.node.attrs.sep }, body.content, body.marks);
    tr.replaceWith(figure.pos, figure.pos + figure.node.nodeSize, bare);
    tr.setSelection(NodeSelection.create(tr.doc, figure.pos));
  }
  tr.scrollIntoView();
  return true;
}

/** Whether a figure's source has more than its body and caption: other arguments, a label, comments. */
function hasFigureExtras(figure: PMNode): boolean {
  const layout: FigureLayout = figure.attrs.layout ?? NEW_FIGURE;
  return figure.attrs.label !== null || (layout.open + (layout.caption?.before ?? '') + layout.rest).replace(/[\s,]/g, '') !== '#figure()';
}

/** How a figure's source lies around its body (image or table call) and caption content, for printing it back. */
interface FigureLayout {
  /** From `#figure` to the body, e.g. `#figure(`. */
  open: string;
  /** Around the caption's content: from the body to the content, and after the content to the end of the argument. */
  caption: { before: string; open: string; close: string } | null;
  /** The rest: other arguments, `)`, a label. */
  rest: string;
}

/** The layout of a figure made in the editor: `#figure(image(..), caption: [..])`. */
const NEW_FIGURE: FigureLayout = { open: '#figure(', caption: null, rest: ')' };

/** A figure's body back in markup: its call (`src`) with a `#`. */
function asMarkup(src: unknown): unknown {
  return typeof src === 'string' && !src.startsWith('#') ? `#${src}` : src;
}

/**
 * `#figure(image("path", ..), ..named) <label>?` or `#figure(table(..), ..)`
 * (whatever the figure's schema accepts of what the call is read as) whose
 * `caption`, if any, is one paragraph of markup; other named arguments stay as
 * written.
 */
function parseFigure(p: TypstParseContext, call: SyntaxNode, sep: string | null): PMNode | null {
  const parsed = figureArgs(p, call);
  if (!parsed) return null;
  const { schema, source } = p;
  const { body, bodyNode, caption } = parsed;
  const { from: start, to: end } = withHash(call);
  const layout: FigureLayout = { open: source.slice(start, body.from), caption: null, rest: '' };
  if (!caption) {
    layout.rest = source.slice(body.to, end);
    return schema.nodes.figure.create({ sep, layout }, [bodyNode]);
  }
  const { from, to, nodes } = captionContent(caption.content);
  layout.caption = { before: source.slice(body.to, caption.arg.from), open: source.slice(caption.arg.from, from), close: source.slice(to, caption.arg.to) };
  layout.rest = source.slice(caption.arg.to, end);
  const captionNode = p.textblock({ type: 'figureCaption', attrs: { src: source.slice(from, to) } }, from, p.inline(nodes));
  return schema.nodes.figure.create({ sep, layout }, [bodyNode, captionNode]);
}

/** The body (call and node) and the caption argument of a figure, if it is an image or table with an optional one-paragraph caption. */
function figureArgs(p: TypstParseContext, call: SyntaxNode): { body: SyntaxNode; bodyNode: PMNode; caption: CaptionArg | null } | null {
  if (!hasOnlyArguments(call)) return null;
  const [body, ...others] = callArguments(call);
  const bodyNode = body ? figureBody(p, body) : null;
  const caption = bodyNode ? captionArg(p, others) : undefined;
  return caption === undefined ? null : { body, bodyNode: bodyNode!, caption };
}

/** A figure's `caption: [..]` argument and its content block. */
interface CaptionArg {
  arg: SyntaxNode;
  content: SyntaxNode;
}

/** A figure's body: a call read as a block the figure holds (`image(..)`, `table(..)`). */
function figureBody(p: TypstParseContext, node: SyntaxNode): PMNode | null {
  const block = p.blockCall(node);
  return block && p.schema.nodes.figure.contentMatch.matchType(block.type) ? block : null;
}

/** Among named arguments, the caption: null if there is none, undefined if the arguments cannot be modelled. */
function captionArg(p: TypstParseContext, args: SyntaxNode[]): CaptionArg | null | undefined {
  const names = args.map((a) => (a.name === 'Named' ? a.getChild('Ident') : null));
  if (names.some((n) => n === null)) return undefined;
  const captions = args.filter((_, i) => p.text(names[i]!) === 'caption');
  if (captions.length === 0) return null;
  const [arg] = captions;
  const content = arg.lastChild!;
  return captions.length === 1 && isClosedContent(content) && p.isOneParagraph(children(content.getChild('Markup')!)) ? { arg, content } : undefined;
}

/** A content block's markup without the spaces at its edges, and where that lies. */
function captionContent(block: SyntaxNode): { from: number; to: number; nodes: SyntaxNode[] } {
  const markup = block.getChild('Markup')!;
  const nodes = children(markup);
  while (nodes[0]?.name === 'Space') nodes.shift();
  while (nodes.at(-1)?.name === 'Space') nodes.pop();
  const from = nodes[0]?.from ?? markup.from;
  return { from, to: nodes.at(-1)?.to ?? from, nodes };
}

/**
 * A figure: its source around the body (image or table) and the caption content, so
 * each prints (and changes) on its own. An added caption goes right after the
 * body; a removed one takes its argument and the comma before it along.
 */
function figureToTypst(out: TypstSerializeState, figure: PMNode, pos: number): void {
  const layout: FigureLayout = figure.attrs.layout ?? NEW_FIGURE;
  const body = figure.child(0);
  out.hidden(layout.open);
  out.block(body, figure, pos + 1);
  if (figure.childCount > 1) {
    const around = layout.caption ?? NEW_CAPTION;
    out.hidden(around.before + around.open);
    out.block(figure.child(1), figure, pos + 1 + body.nodeSize);
    out.closing(around.close);
  } else if (layout.caption) {
    out.hidden(layout.caption.before.replace(/,\s*$/, ''));
  }
  out.hidden(layout.rest);
}

const NEW_CAPTION = { before: ', ', open: 'caption: [', close: ']' };

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    figures: {
      /**
       * Gives the figure body at `pos` (an image block, bare or in a figure) an empty caption, with the cursor in it:
       * a bare block becomes `#figure(body, caption: [])`, a figure without a caption gets the argument right after
       * its body.
       */
      addFigureCaption: (pos: number) => ReturnType;
      /**
       * Removes the caption of the figure around the body at `pos`. A figure that has nothing else (no label, no
       * other arguments) becomes the bare block again; otherwise it stays a figure, so references to it keep
       * working. The body ends up selected.
       */
      removeFigureCaption: (pos: number) => ReturnType;
    };
  }
}
