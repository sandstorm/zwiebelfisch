// Text alignment: `#align(..)[..]` blocks, justified paragraphs (`#par(justify: ..)[..]`) and the Align menu.
// Entry of visual-view/builtins/alignment/. See ARCHITECTURE.md, "VisualView".
import type { Node } from '@tiptap/pm/model';
import {
  type Action, type Call, type Printer, type ProjectionContext, type TypstNodeSpec, type VisualViewContribution, children, isClosedContent, svg,
} from '../../../hosts/visual-view/visual-view';
import { alignArgs, type TextAlignment } from '../model/model';
import { TextAlign, textAlignAt } from './text-align';

/**
 * `#align(<literal alignment>)[..]` (`left|center|right|start|end`, optionally
 * `+` one vertical alignment) is an `alignment` block whose content is
 * segmented like the document; `#par(justify: <bool>)[one paragraph]` is that
 * paragraph with its `justify` flag. The Align menu (left, center, right,
 * justify; its icon is the current alignment) and Mod-Shift-L/E/R/J set them.
 */
export const alignment: VisualViewContribution = {
  id: 'alignment',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(ALIGNMENT),
      visualView.registerNode(JUSTIFIED_PARAGRAPH),
      visualView.registerToolbarGroup({
        kind: 'menu',
        id: 'align',
        order: 40,
        label: 'Align',
        icon: (editor) => ALIGNMENTS.find((a) => a.active!(editor))?.icon ?? ICONS.alignLeft,
      }),
      ...ALIGNMENTS.map((action, i) => visualView.registerToolbarItem({ group: 'align', order: 10 * (i + 1), action })),
    );
  },
};

/** How an alignment block's source lies around its blocks, for printing it back. */
interface AlignLayout {
  /** The alignment argument as written. */
  args: string;
  /** The source up to the first block (`#align(args)[`, whitespace) and after the last one. */
  open: string;
  close: string;
}

const ALIGNMENT: TypstNodeSpec = {
  name: 'alignment',
  extension: TextAlign,
  anchors: ['layout'],
  labelled: true,
  blockCalls: { align: projectAlignment },
  print: printAlignment,
};

/** Paragraphs that are justified (or not) on their own: `#par(justify: ..)[..]` around their text. */
const JUSTIFIED_PARAGRAPH: TypstNodeSpec = {
  name: 'paragraph',
  blockCalls: { par: projectJustified },
  print: printParagraph,
};

/** `#align(<literal alignment>)[..]`: an alignment block whose content is projected like the document's. */
function projectAlignment(p: ProjectionContext, call: Call, sep: string | null): Node | null {
  const { args } = call;
  const body = args.at(-1);
  const close = args.at(-2);
  if (args[0]?.name !== 'LeftParen' || close?.name !== 'RightParen' || !body || !isClosedContent(body)) return null;
  const argText = p.source.slice(args[0].to, close.from);
  if (!alignArgs(argText)) return null;
  const { content, from, to } = p.blocks(body);
  const layout: AlignLayout = { args: argText, open: p.source.slice(call.from, from), close: p.source.slice(to, call.to) };
  return p.schema.nodes.alignment.create({ args: argText, sep, layout }, content);
}

/** `#par(justify: <bool>)[..]` around one paragraph's inline content: that paragraph, with its `justify` flag. */
function projectJustified(p: ProjectionContext, call: Call, sep: string | null): Node | null {
  const { args } = call;
  if (args.map((a) => a.name).join() !== 'LeftParen,Named,RightParen,ContentBlock' || !isClosedContent(args[3])) return null;
  const justify = /^justify\s*:\s*(true|false)$/.exec(p.text(args[1]));
  const content = children(args[3].getChild('Markup')!);
  if (!justify || content.length === 0 || !p.isOneParagraph(content)) return null;
  const attrs = { src: p.text(call), sep, justify: justify[1] === 'true' };
  return p.textblock({ type: 'paragraph', attrs }, call.from, p.inline(content));
}

/** `#align(args)[blocks]`, keeping the source around the blocks as projected; only a changed `args` is re-printed. New: `#align(x)[A\n\nB]`. */
function printAlignment(out: Printer, block: Node, pos: number): void {
  const args: string = block.attrs.args;
  const layout: AlignLayout = block.attrs.layout ?? { args, open: `#align(${args})[`, close: ']' };
  const head = '#align(';
  out.hidden(layout.args === args ? layout.open : head + args + layout.open.slice(head.length + layout.args.length));
  out.blocks(block, pos + 1, '\n\n');
  out.closing(layout.close);
}

/** An edited paragraph: its text, in `#par(justify: x)[..]` if it has `justify`. */
function printParagraph(out: Printer, block: Node, pos: number): void {
  const justify: boolean | null = block.attrs.justify ?? null;
  if (justify !== null) out.hidden(`#par(justify: ${justify})[`);
  out.inline(block, pos + 1);
  if (justify !== null) out.hidden(']');
  out.endBlock(pos + block.nodeSize - 1, block.content.size === 0);
}

const ICONS = {
  alignLeft: svg('<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>'),
  alignJustify: svg('<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>'),
};

/** Radio-like: the button of the selection's (effective) alignment is pressed. */
const alignAction = (label: string, alignment: TextAlignment, shortcut: string, icon: string): Action => ({
  label,
  shortcut,
  icon,
  run: (c) => c.setTextAlign(alignment),
  active: (e) => textAlignAt(e.state) === alignment,
});

const ALIGNMENTS: Action[] = [
  alignAction('Align left', 'left', 'Mod+Shift+L', ICONS.alignLeft),
  alignAction('Center', 'center', 'Mod+Shift+E', ICONS.alignCenter),
  alignAction('Align right', 'right', 'Mod+Shift+R', ICONS.alignRight),
  alignAction('Justify', 'justify', 'Mod+Shift+J', ICONS.alignJustify),
];
