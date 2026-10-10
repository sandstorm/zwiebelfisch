// Custom styles in the Visual view: declared paragraph styles as styled blocks (`#note[..]`), text styles as a
// mark (`#key[..]`), and the text style menu. Entry of extensions/styles/visual-view/. See ARCHITECTURE.md,
// "Custom styles".
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node } from '@tiptap/pm/model';
import {
  children, isClosedContent, parenthesized, type Call, type Placed, type Printer, type ProjectionContext, type ToolbarContext, type ToolbarControl,
  type TypstMarkSpec, type TypstNodeSpec, type VisualViewContribution,
} from '../../../hosts/visual-view/visual-view';
import type { ProjectStyles, Style } from '../model/model';
import { StyleMenu } from './style-menu';
import { StyledBlock, StyleMark } from './style-nodes';

export interface StylesOptions {
  /** The project's styles: their calls show as styled, editable text (default: such calls stay raw boxes). */
  styles?: ProjectStyles;
  /** "New style…" in the text style menu (default: no such entry). */
  create?(): void;
}

/** The origin of the import a newly applied style adds to the document. */
const STYLE_IMPORT = 'style-import';

/**
 * Custom styles (see `model/`): a call of a declared paragraph
 * style that is a block of its own (`#note[..]`, `#callout(..)[..]`) is a
 * `styledBlock` holding blocks; a text style call in running text
 * (`#key[..]`) is text with a `style` mark. Undeclared calls stay raw; a style
 * declared or removed re-projects every view. The text style menu (normal
 * text, headings 1–3, the project's styles, "New style…") applies them,
 * importing a style where it is now used.
 */
export function customStyles(options: StylesOptions = {}): VisualViewContribution {
  const declared = declaredStyles(options.styles);
  // a style declared or removed: every view projects its document again
  const onDidChange = options.styles?.onDidChange;
  return {
    id: 'styles',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode({ ...STYLED_BLOCK, blockCalls: { '*': (p, call, sep) => styledBlock(p, call, sep, declared()) }, onDidChange }),
        visualView.registerMark({
          ...STYLE,
          inlineCalls: [{ matches: (_p, call) => declared().get(call.name)?.kind === 'text', project: (p, call, marks) => styleCall(p, call, marks, declared()) }],
        }),
        visualView.registerToolbarGroup({ kind: 'group', id: 'text-style', order: 20 }),
        visualView.registerToolbarItem({ group: 'text-style', create: (toolbar) => styleMenu(toolbar, options) }),
      );
    },
  };
}

type Declared = ReadonlyMap<string, { kind: 'paragraph' | 'text'; label: string }>;

/** The declared styles by function name, as of now (made anew when the list changes). */
function declaredStyles(source: ProjectStyles | undefined): () => Declared {
  let list: readonly Style[] | null = null;
  let map: Declared = new Map();
  return () => {
    const current = source?.styles() ?? [];
    if (current !== list) {
      list = current;
      map = new Map(current.map((style) => [style.name, { kind: style.kind, label: style.label }]));
    }
    return map;
  };
}

/** How a styled block's source lies around its content: `#note[` (or `#callout(..)[`) and `]`. Null: a new one. */
interface StyleLayout {
  open: string;
  close: string;
}

const STYLED_BLOCK: TypstNodeSpec = {
  name: 'styledBlock',
  extension: StyledBlock,
  anchors: ['layout'],
  labelled: true,
  print: printStyledBlock,
};

const STYLE: TypstMarkSpec = {
  name: 'style',
  extension: StyleMark,
  print: (mark) => ({ open: mark.attrs.head ?? `#${mark.attrs.name}[`, close: ']' }),
};

/** `#name(..)?[content]` of a declared paragraph style: a `styledBlock` whose content is segmented like the document. */
function styledBlock(p: ProjectionContext, call: Call, sep: string | null, declared: Declared): Node | null {
  const style = declared.get(call.name);
  const content = call.args.at(-1);
  const parens = call.args.slice(0, -1);
  if (style?.kind !== 'paragraph' || !content || !isClosedContent(content) || (parens.length > 0 && !parenthesized(parens))) return null;
  const { content: inside, from, to } = p.blocks(content);
  const layout: StyleLayout = { open: p.source.slice(call.from, from), close: p.source.slice(to, call.to) };
  return p.schema.nodes.styledBlock.create({ name: call.name, title: style.label, sep, layout }, inside);
}

/** `#name[..]` around a styled block's blocks, or the call around them as projected. */
function printStyledBlock(out: Printer, block: Node, pos: number): void {
  const { open, close }: StyleLayout = block.attrs.layout ?? { open: `#${block.attrs.name}[`, close: ']' };
  out.hidden(open);
  out.blocks(block, pos + 1, '\n\n');
  out.closing(close);
}

/** `#key[text]` (or `#key(..)[text]`) of a declared text style, with non-empty, single-paragraph text; null otherwise. */
function styleCall(p: ProjectionContext, { node, name, args }: Call, marks: readonly Mark[], declared: Declared): Placed[] | null {
  const style = declared.get(name);
  const content = args.at(-1);
  const parens = args.slice(0, -1);
  if (style?.kind !== 'text' || !content || !isClosedContent(content) || (parens.length > 0 && !parenthesized(parens))) return null;
  const inside: SyntaxNode[] = children(content.getChild('Markup')!);
  if (inside.length === 0 || inside.some((n) => n.name === 'Parbreak')) return null;
  // the `#` before the call up to and with the `[`: printed again as is
  const head = p.source.slice(node.from - 1, content.from + 1);
  return p.inline(inside, p.schema.marks.style.create({ name, title: style.label, head }).addToSet(marks));
}

/** The text style menu of one view: applying a style imports it into the view's document where needed. */
function styleMenu(toolbar: ToolbarContext, { styles: source, create }: StylesOptions): ToolbarControl {
  const { document } = toolbar;
  const menuStyles = source && {
    styles: () => source.styles(),
    onDidChange: source.onDidChange,
    applied: (style: Style) => {
      const change = source.calculateImportChange(document, style, toolbar.selection().from);
      if (change) document.change([change], STYLE_IMPORT);
    },
    create,
  };
  return new StyleMenu(toolbar.root.ownerDocument, toolbar.editor, menuStyles);
}
