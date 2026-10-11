// Custom styles in the Visual view: declared paragraph styles as styled blocks (`#note[..]`), text styles as a
// mark (`#key[..]`), and the text style menu. See ARCHITECTURE.md, "Custom styles".
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node } from '@tiptap/pm/model';
import { calleeName, children, trailingContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import type { Placed, TypstSerializeState, TypstParseContext } from '../../../hosts/projection/projection';
import type { TextStyle, TextStyleProvider, TypstMarkSpec, TypstNodeSpec, VisualViewContext, VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import type { ProjectStyles } from '../model/style-index';
import type { Style } from '../model/discover';
import { StyledBlock, StyleMark } from './style-nodes';

export interface StylesOptions {
  /** The project's styles: their calls show as styled, editable text. */
  styles: ProjectStyles;
  /** "New style…" in the text style menu. */
  create(): void;
}

/** The origin of the import a newly applied style adds to the document. */
const STYLE_IMPORT = 'style-import';

/** A text style's mark priority: outside bold and italic (100) where it covers the same text (`#key[*x*]`), inside links (120) and notes. */
const STYLE_PRIORITY = 110;

/**
 * Custom styles (see `model/`): a call of a declared paragraph
 * style that is a block of its own (`#note[..]`, `#callout(..)[..]`) is a
 * `styledBlock` holding blocks; a text style call in running text
 * (`#key[..]`) is text with a `style` mark. Undeclared calls stay raw; a style
 * declared or removed re-projects every view. The text style menu lists the
 * project's styles and "New style…" (after normal text and what other
 * extensions contribute) and applies them, importing a style where it is now
 * used.
 */
export function customStyles(options: StylesOptions): VisualViewContribution {
  const declared = declaredStyles(options.styles);
  // a style declared or removed: every view projects its document again
  const onDidChange = options.styles.onDidChange;
  return {
    id: 'styles',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode({ ...STYLED_BLOCK, blockCalls: { '*': (p, call, sep) => styledBlock(p, call, sep, declared()) }, onDidChange }),
        visualView.registerMark({
          ...STYLE,
          inlineCalls: [{ matches: (p, call) => declared().get(calleeName(call, p.source))?.kind === 'text', project: (p, call, marks) => styleCall(p, call, marks, declared()) }],
        }, { priority: STYLE_PRIORITY }),
        visualView.registerTextStyleProvider(textStyles(options)),
      );
    },
  };
}

type Declared = ReadonlyMap<string, { kind: 'paragraph' | 'text'; label: string }>;

/** The declared styles by function name, as of now (made anew when the list changes). */
function declaredStyles(source: ProjectStyles): () => Declared {
  let list: readonly Style[] | null = null;
  let map: Declared = new Map();
  return () => {
    const current = source.styles();
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
function styledBlock(p: TypstParseContext, call: SyntaxNode, sep: string | null, declared: Declared): Node | null {
  const name = calleeName(call, p.source);
  const style = declared.get(name);
  const blocks = trailingContent(call);
  if (style?.kind !== 'paragraph' || blocks?.length !== 1) return null;
  const { content: inside, from, to } = p.blocks(blocks[0]);
  const { from: start, to: end } = withHash(call);
  const layout: StyleLayout = { open: p.source.slice(start, from), close: p.source.slice(to, end) };
  return p.schema.nodes.styledBlock.create({ name, title: style.label, sep, layout }, inside);
}

/** `#name[..]` around a styled block's blocks, or the call around them as projected. */
function printStyledBlock(out: TypstSerializeState, block: Node, pos: number): void {
  const { open, close }: StyleLayout = block.attrs.layout ?? { open: `#${block.attrs.name}[`, close: ']' };
  out.hidden(open);
  out.blocks(block, pos + 1, '\n\n');
  out.closing(close);
}

/** `#key[text]` (or `#key(..)[text]`) of a declared text style, with non-empty, single-paragraph text; null otherwise. */
function styleCall(p: TypstParseContext, call: SyntaxNode, marks: readonly Mark[], declared: Declared): Placed[] | null {
  const name = calleeName(call, p.source);
  const style = declared.get(name);
  const blocks = trailingContent(call);
  if (style?.kind !== 'text' || blocks?.length !== 1) return null;
  const inside = children(blocks[0].getChild('Markup')!);
  if (inside.length === 0 || inside.some((n) => n.name === 'Parbreak')) return null;
  // the `#` before the call up to and with the `[`: printed again as is
  const head = p.source.slice(withHash(call).from, blocks[0].from + 1);
  return p.inline(inside, p.schema.marks.style.create({ name, title: style.label, head }).addToSet(marks));
}

/**
 * The text style menu's entries: the paragraph styles (wrap the selected blocks, `#note[..]`; Normal text takes them
 * off), the text styles (toggle on a selection, `#key[..]`), and "New style…". Applying a style imports it into the
 * view's document where needed.
 */
function textStyles({ styles: source, create }: StylesOptions): TextStyleProvider {
  return {
    provideTextStyles: (view) => [...source.styles().map((style) => textStyle(style, view, source)), { id: 'new-style', label: 'New style…', order: 1000, apply: (chain) => chain, applied: create }],
    onDidChangeTextStyles: source.onDidChange,
  };
}

/** The menu entry of `style`, in `view`. */
function textStyle(style: Style, view: VisualViewContext, source: ProjectStyles): TextStyle {
  const applied = { name: style.name, label: style.label };
  const entry = {
    label: style.label,
    applied: () => {
      const change = source.calculateImportChange(view.document, style, view.selection().from);
      if (change) view.document.change([change], STYLE_IMPORT);
    },
  };
  if (style.kind === 'paragraph') {
    return {
      ...entry,
      id: `paragraph:${style.name}`,
      section: 'Paragraph styles',
      order: 100,
      apply: (chain) => chain.setParagraphStyle(applied),
      isActive: (editor) => editor.isActive('styledBlock', { name: style.name }),
      remove: (chain) => chain.unsetParagraphStyle(),
    };
  }
  return {
    ...entry,
    id: `text:${style.name}`,
    section: 'Text styles',
    order: 200,
    toggle: true,
    apply: (chain) => chain.toggleTextStyle(applied),
    enabled: (editor) => !editor.state.selection.empty && editor.can().toggleTextStyle(applied),
    isActive: (editor) => editor.isActive('style', { name: style.name }),
  };
}
