// What the alignment extension contributes to the Visual editor. See ../alignment.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { callArguments, children, namedArgument, trailingContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type ChainButton, type Submenu, type TypstNodeSpec } from '../../../hosts/visual-editor/visual-editor';
import { type TypstSerializeState, type TypstParseContext } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { alignArgs, type TextAlignment } from '../model/alignment-syntax';
import { TextAlign, textAlignAt } from './text-align';

/** `#align(<literal alignment>)[..]`: an `alignment` block whose content is read like the document's. */
export const ALIGNMENT: TypstNodeSpec = {
  name: 'alignment',
  tiptap: TextAlign,
  typst: { parseTypst: { calls: { align: { block: parseAlignment } } }, toTypst: alignmentToTypst, anchors: ['layout'], labelled: true },
};

/** Paragraphs that are justified (or not) on their own: `#par(justify: ..)[..]` around their text. */
export const JUSTIFIED_PARAGRAPH: TypstNodeSpec = {
  name: 'paragraph',
  typst: { parseTypst: { calls: { par: { block: parseJustified } } }, toTypst: paragraphToTypst },
};

/** Radio-like: the button of the selection's (effective) alignment is pressed. */
const alignButton = (title: string, alignment: TextAlignment, keybinding: string, icon: string): ChainButton => ({
  command: `alignment.align.${alignment}`,
  title,
  keybinding,
  icon,
  chain: (c) => c.setTextAlign(alignment),
  toggled: ({ tiptap }) => textAlignAt(tiptap.state) === alignment,
});

const ICONS = {
  alignLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  alignJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
};

/** The Align menu's entries (`visualEditor/align`): left, center, right, justify. */
export const ALIGNMENTS: ChainButton[] = [
  alignButton('Align left', 'left', 'Mod+Shift+L', ICONS.alignLeft),
  alignButton('Center', 'center', 'Mod+Shift+E', ICONS.alignCenter),
  alignButton('Align right', 'right', 'Mod+Shift+R', ICONS.alignRight),
  alignButton('Justify', 'justify', 'Mod+Shift+J', ICONS.alignJustify),
].map((button, i) => ({ ...button, order: 10 * (i + 1) }));

/** The Align menu in the toolbar's `4_align` group; its icon is the selection's current alignment. */
export const ALIGN_MENU: Submenu = {
  id: 'visualEditor/align',
  label: 'Align',
  parent: 'visualEditor/toolbar',
  group: '4_align',
  icon: (context) => ALIGNMENTS.find((button) => button.toggled!(context))?.icon ?? ICONS.alignLeft,
};

/** `#align(<literal alignment>)[..]`: an alignment block whose content is parsed like the document's. */
function parseAlignment(p: TypstParseContext, call: SyntaxNode, sep: string | null): Node | null {
  const blocks = trailingContent(call);
  const open = call.getChild('Args')?.getChild('LeftParen');
  const close = call.getChild('Args')?.getChild('RightParen');
  if (blocks?.length !== 1 || !open || !close) return null;
  const argText = p.source.slice(open.to, close.from);
  if (!alignArgs(argText)) return null;
  const { content, from, to } = p.blocks(blocks[0]);
  const { from: start, to: end } = withHash(call);
  const layout: AlignLayout = { args: argText, open: p.source.slice(start, from), close: p.source.slice(to, end) };
  return p.schema.nodes.alignment.create({ args: argText, sep, layout }, content);
}

/** How an alignment block's source lies around its blocks, for printing it back. */
interface AlignLayout {
  /** The alignment argument as written. */
  args: string;
  /** The source up to the first block (`#align(args)[`, whitespace) and after the last one. */
  open: string;
  close: string;
}

/** `#align(args)[blocks]`, keeping the source around the blocks as parsed; only a changed `args` is written anew. New: `#align(x)[A\n\nB]`. */
function alignmentToTypst(out: TypstSerializeState, block: Node, pos: number): void {
  const args: string = block.attrs.args;
  const layout: AlignLayout = block.attrs.layout ?? { args, open: `#align(${args})[`, close: ']' };
  const head = '#align(';
  out.hidden(layout.args === args ? layout.open : head + args + layout.open.slice(head.length + layout.args.length));
  out.blocks(block, pos + 1, '\n\n');
  out.closing(layout.close);
}

/** `#par(justify: <bool>)[..]` around one paragraph's inline content: that paragraph, with its `justify` flag. */
function parseJustified(p: TypstParseContext, call: SyntaxNode, sep: string | null): Node | null {
  const blocks = trailingContent(call);
  const justify = namedArgument(call, 'justify', p.source);
  const value = justify && p.text(justify);
  if (blocks?.length !== 1 || callArguments(call).length !== 1 || (value !== 'true' && value !== 'false')) return null;
  const content = children(blocks[0].getChild('Markup')!);
  if (content.length === 0 || !p.isOneParagraph(content)) return null;
  const range = withHash(call);
  const attrs = { src: p.text(range), sep, justify: value === 'true' };
  return p.textblock({ type: 'paragraph', attrs }, range.from, p.inline(content));
}

/** An edited paragraph: its text, in `#par(justify: x)[..]` if it has `justify`. */
function paragraphToTypst(out: TypstSerializeState, block: Node, pos: number): void {
  const justify: boolean | null = block.attrs.justify ?? null;
  if (justify !== null) out.hidden(`#par(justify: ${justify})[`);
  out.inline(block, pos + 1);
  if (justify !== null) out.hidden(']');
  out.endBlock(pos + block.nodeSize - 1, block.content.size === 0);
}
