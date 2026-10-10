// Figures: `#figure(image(..) | table(..), caption: [..])`, read with the caption as rich text and printed back
// around their parts. See images.ts.
import type { SyntaxNode } from '@lezer/common';
import { Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { children, isClosedContent, parenthesized, type Call, type Printer, type ProjectionContext } from '../../../hosts/visual-view/visual-view';

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
const NEW_CAPTION = { before: ', ', open: 'caption: [', close: ']' };

/**
 * `#figure(image(..), caption: [..])`: the image (an `image` node holding
 * the call without its `#`) or a table (`table(..)`) and, optionally, the
 * caption as rich text. `layout` is how the figure's source lies around the
 * two (owned by the projection); other arguments and a label after the call
 * live there.
 */
export const Figure = Node.create({
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
export const FigureCaption = Node.create({
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
 * `#figure(image("path", ..), ..named) <label>?` or `#figure(table(..), ..)`
 * (whatever the figure's schema accepts of what the call projects to) whose
 * `caption`, if any, is one paragraph of markup; other named arguments stay as
 * written.
 */
export function projectFigure(p: ProjectionContext, call: Call, sep: string | null): PMNode | null {
  const parsed = figureArgs(p, call.args);
  if (!parsed) return null;
  const { schema, source } = p;
  const { body, bodyNode, caption } = parsed;
  const layout: FigureLayout = { open: source.slice(call.from, body.from), caption: null, rest: '' };
  if (!caption) {
    layout.rest = source.slice(body.to, call.to);
    return schema.nodes.figure.create({ sep, layout }, [bodyNode]);
  }
  const { from, to, nodes } = captionContent(caption.content);
  layout.caption = { before: source.slice(body.to, caption.arg.from), open: source.slice(caption.arg.from, from), close: source.slice(to, caption.arg.to) };
  layout.rest = source.slice(caption.arg.to, call.to);
  const captionNode = p.textblock({ type: 'figureCaption', attrs: { src: source.slice(from, to) } }, from, p.inline(nodes));
  return schema.nodes.figure.create({ sep, layout }, [bodyNode, captionNode]);
}

/** The body (call and node) and the caption argument of a figure, if it is an image or table with an optional one-paragraph caption. */
function figureArgs(p: ProjectionContext, args: SyntaxNode[]): { body: SyntaxNode; bodyNode: PMNode; caption: CaptionArg | null } | null {
  if (!parenthesized(args)) return null;
  const [body, ...others] = args.slice(1, -1).filter((a) => a.name !== 'Space' && a.name !== 'Comma');
  const bodyNode = body ? figureBody(p, body) : null;
  const caption = bodyNode ? captionArg(p, others) : undefined;
  return caption === undefined ? null : { body, bodyNode: bodyNode!, caption };
}

/** A figure's body: a call projected to a block the figure holds (`image(..)`, `table(..)`). */
function figureBody(p: ProjectionContext, node: SyntaxNode): PMNode | null {
  const block = p.blockCall(node);
  return block && p.schema.nodes.figure.contentMatch.matchType(block.type) ? block : null;
}

/** A figure's `caption: [..]` argument and its content block. */
interface CaptionArg {
  arg: SyntaxNode;
  content: SyntaxNode;
}

/** Among named arguments, the caption: null if there is none, undefined if the arguments cannot be modelled. */
function captionArg(p: ProjectionContext, args: SyntaxNode[]): CaptionArg | null | undefined {
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

/** Whether a figure's source has more than its image and caption: other arguments, a label, comments. */
export function hasFigureExtras(figure: PMNode): boolean {
  const layout: FigureLayout = figure.attrs.layout ?? NEW_FIGURE;
  return figure.attrs.label !== null || (layout.open + (layout.caption?.before ?? '') + layout.rest).replace(/[\s,]/g, '') !== '#figure()';
}

/**
 * A figure: its source around the body (image or table) and the caption content, so
 * each prints (and changes) on its own. An added caption goes right after the
 * body; a removed one takes its argument and the comma before it along.
 */
export function printFigure(out: Printer, figure: PMNode, pos: number): void {
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
